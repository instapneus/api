const supabase = require("../../../config/supabase");
const AppError = require("../../../errors/app-error");

/**
 * Fetches question definitions and valid options for selected services.
 *
 * Returns a Map where the key is a service ID:
 *
 * Map {
 *   serviceId => [question, question]
 * }
 */
async function getQuestionsByServiceIds(serviceIds) {
  if (!serviceIds?.length) {
    return new Map();
  }

  const { data: questions, error } = await supabase
    .from("service_questions")
    .select(
      `
        id,
        service_id,
        code,
        input_type,
        is_required,

        options:service_question_options(
          id,
          question_id,
          is_active
        )
      `
    )
    .in("service_id", serviceIds);

  if (error) {
    throw new AppError("Failed to fetch service questions", {
      status: 500,
      code: "SERVICE_QUESTIONS_FETCH_FAILED",
      meta: error,
    });
  }

  const questionsByServiceId = new Map();

  for (const question of questions || []) {
    const serviceQuestions =
      questionsByServiceId.get(question.service_id) || [];

    serviceQuestions.push({
      ...question,

      options: (question.options || []).filter((option) => option.is_active),
    });

    questionsByServiceId.set(question.service_id, serviceQuestions);
  }

  return questionsByServiceId;
}

/**
 * Validates and creates all answers belonging to one vehicle's selected
 * services.
 */
async function createAnswers({
  vehicleService,
  createdServices,
  questionsByServiceId,
}) {
  const answerRows = [];

  for (const createdService of createdServices) {
    const serviceId = createdService.service_id;

    const questions = questionsByServiceId.get(serviceId) || [];

    const submittedAnswers = vehicleService.serviceAnswers?.[serviceId] || {};

    for (const question of questions) {
      const answer = submittedAnswers[question.id];

      if (question.is_required && !hasAnswer(answer)) {
        throw new AppError("A required service question was not answered", {
          status: 400,
          code: "MISSING_REQUIRED_SERVICE_ANSWER",
          meta: {
            serviceId,
            questionId: question.id,
            questionCode: question.code,
          },
        });
      }

      // Optional question without an answer.
      if (!hasAnswer(answer)) {
        continue;
      }

      answerRows.push(
        ...mapAnswerToRows({
          reservationVehicleServiceId: createdService.id,
          question,
          answer,
        })
      );
    }
  }

  if (!answerRows.length) {
    return [];
  }

  const { data, error } = await supabase
    .from("reservation_vehicle_service_answers")
    .insert(answerRows)
    .select();

  if (error) {
    throw new AppError("Failed to create service answers", {
      status: 500,
      code: "CREATE_SERVICE_ANSWERS_FAILED",
      meta: error,
    });
  }

  return data || [];
}

/**
 * Converts one submitted answer into one or more database rows.
 */
function mapAnswerToRows({ reservationVehicleServiceId, question, answer }) {
  const baseRow = {
    reservation_vehicle_service_id: reservationVehicleServiceId,

    question_id: question.id,

    option_id: null,
    value_text: null,
    value_number: null,
    value_boolean: null,
  };

  switch (question.input_type) {
    case "radio":
    case "select": {
      validateOptionIds(question, [answer]);

      return [
        {
          ...baseRow,
          option_id: answer,
        },
      ];
    }

    case "checkbox_group": {
      if (!Array.isArray(answer)) {
        throw new AppError("Invalid checkbox-group service answer", {
          status: 400,
          code: "INVALID_SERVICE_ANSWER",
          meta: {
            questionId: question.id,
            expected: "array",
            received: typeof answer,
          },
        });
      }

      validateOptionIds(question, answer);

      return answer.map((optionId) => ({
        ...baseRow,
        option_id: optionId,
      }));
    }

    case "boolean": {
      return [
        {
          ...baseRow,
          value_boolean: Boolean(answer),
        },
      ];
    }

    case "number": {
      const numericAnswer = Number(answer);

      if (!Number.isFinite(numericAnswer)) {
        throw new AppError("Invalid numeric service answer", {
          status: 400,
          code: "INVALID_SERVICE_ANSWER",
          meta: {
            questionId: question.id,
            answer,
          },
        });
      }

      return [
        {
          ...baseRow,
          value_number: numericAnswer,
        },
      ];
    }

    case "text": {
      return [
        {
          ...baseRow,
          value_text: String(answer).trim(),
        },
      ];
    }

    default: {
      throw new AppError("Unsupported service question type", {
        status: 400,
        code: "UNSUPPORTED_SERVICE_QUESTION_TYPE",
        meta: {
          questionId: question.id,
          inputType: question.input_type,
        },
      });
    }
  }
}

/**
 * Prevents an option belonging to another question from being submitted.
 */
function validateOptionIds(question, optionIds) {
  const validOptionIds = new Set(
    (question.options || []).map((option) => option.id)
  );

  const invalidOptionIds = optionIds.filter(
    (optionId) => !validOptionIds.has(optionId)
  );

  if (invalidOptionIds.length) {
    throw new AppError("Invalid service question option", {
      status: 400,
      code: "INVALID_SERVICE_QUESTION_OPTION",
      meta: {
        questionId: question.id,
        invalidOptionIds,
      },
    });
  }
}

/**
 * Determines whether a submitted answer has an actual value.
 *
 * false and 0 are valid answers and must not be treated as empty.
 */
function hasAnswer(answer) {
  if (Array.isArray(answer)) {
    return answer.length > 0;
  }

  return answer !== null && answer !== undefined && answer !== "";
}

module.exports = {
  getQuestionsByServiceIds,
  createAnswers,
};
