const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

async function getServices(categories) {
  let query = supabase
    .from("services")
    .select(
      `
      *,
      questions:service_questions(
        id,
        service_id,
        code,
        label_fr,
        label_en,
        input_type,
        is_required,
        display_order,
        placeholder_fr,
        placeholder_en,
        validation,

        options:service_question_options(
          id,
          question_id,
          code,
          label_fr,
          label_en,
          price_adjustment,
          display_order,
          is_active
        )
      )
    `
    )
    .order("display_order", { ascending: true });

  if (categories) {
    const categoryList = categories
      .split(",")
      .map((category) => category.trim())
      .filter(Boolean);

    query = query.in("category", categoryList);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError("Failed to fetch services", {
      status: 500,
      code: "GET_SERVICES_FAILED",
      meta: error,
    });
  }

  return (data || []).map((service) => ({
    ...service,

    questions: (service.questions || [])
      .sort((a, b) => a.display_order - b.display_order)
      .map((question) => ({
        ...question,
        options: (question.options || [])
          .filter((option) => option.is_active)
          .sort((a, b) => a.display_order - b.display_order),
      })),
  }));
}

module.exports = {
  getServices,
};
