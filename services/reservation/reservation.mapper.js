/**
 * Converts raw vehicle rows into the frontend confirmation format.
 *
 * Both readable answer metadata and serviceAnswers are returned.
 *
 * serviceAnswers is useful when the frontend needs to rebuild the edit form.
 */
function mapVehicles(vehiclesRaw) {
  return (vehiclesRaw || []).map((vehicle) => {
    const selectedServices = vehicle.selected_services || [];

    return {
      id: vehicle.id,

      year: vehicle.year,
      brand: vehicle.brand,
      brand_id: vehicle.brand_id,
      model: vehicle.model,
      model_id: vehicle.model_id,
      color: vehicle.color,
      engineSize: vehicle.engine_size,
      comments: vehicle.comments || "",

      services: selectedServices.map(mapSelectedService),

      serviceAnswers: buildServiceAnswers(selectedServices),
    };
  });
}

function mapSelectedService(selectedService) {
  const service = selectedService.service;

  return {
    id: service.id,
    name: service.name,
    nameFr: service.name_fr,
    nameEn: service.name_en,
    code: service.code,
    category: service.category,
    price: service.price,

    answers: (selectedService.answers || []).map(mapServiceAnswer),
  };
}

function mapServiceAnswer(answer) {
  return {
    id: answer.id,

    question: answer.question
      ? {
          id: answer.question.id,
          code: answer.question.code,
          inputType: answer.question.input_type,
          labelFr: answer.question.label_fr,
          labelEn: answer.question.label_en,
        }
      : null,

    option: answer.option
      ? {
          id: answer.option.id,
          code: answer.option.code,
          labelFr: answer.option.label_fr,
          labelEn: answer.option.label_en,

          priceAdjustment: answer.option.price_adjustment,
        }
      : null,

    value: getStoredAnswerValue(answer),
  };
}

/**
 * Reconstructs the same serviceAnswers structure used by Angular:
 *
 * {
 *   [serviceId]: {
 *     [questionId]: answer
 *   }
 * }
 */
function buildServiceAnswers(selectedServices) {
  const serviceAnswers = {};

  for (const selectedService of selectedServices) {
    const serviceId = selectedService.service_id;

    if (!serviceAnswers[serviceId]) {
      serviceAnswers[serviceId] = {};
    }

    for (const answer of selectedService.answers || []) {
      const questionId = answer.question_id || answer.question?.id;

      if (!questionId) {
        continue;
      }

      const value = getStoredAnswerValue(answer);

      /*
       * Multiple rows for one question indicate a checkbox-group answer.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          serviceAnswers[serviceId],
          questionId
        )
      ) {
        const currentValue = serviceAnswers[serviceId][questionId];

        serviceAnswers[serviceId][questionId] = Array.isArray(currentValue)
          ? [...currentValue, value]
          : [currentValue, value];

        continue;
      }

      serviceAnswers[serviceId][questionId] = value;
    }
  }

  return serviceAnswers;
}

function getStoredAnswerValue(answer) {
  if (answer.option_id) {
    return answer.option_id;
  }

  if (answer.value_text !== null && answer.value_text !== undefined) {
    return answer.value_text;
  }

  if (answer.value_number !== null && answer.value_number !== undefined) {
    return answer.value_number;
  }

  if (answer.value_boolean !== null && answer.value_boolean !== undefined) {
    return answer.value_boolean;
  }

  return null;
}

function mapReservation({
  reservation,
  vehicles,
  tireRequest,
  hasValidToken,
  upcomingReservations = [],
}) {
  return {
    id: reservation.id,
    status: reservation.status,

    reservationType: reservation.reservation_type,
    serviceType: reservation.service_type,
    serviceCount: reservation.service_count,

    customer: {
      firstName: reservation.customer.first_name,
      lastName: reservation.customer.last_name,
      email: hasValidToken ? reservation.customer.email : "",
      phone: hasValidToken ? reservation.customer.phone : "",
    },

    company: reservation.company
      ? {
          id: reservation.company.id,
          name: reservation.company.name,
          code: reservation.company.code,
        }
      : null,

    location: reservation.location
      ? {
          id: reservation.location.id,
          name: reservation.location.name,
          is_oil_change_active: reservation.location.is_oil_change_active,
          address: reservation.location.address,
          city: reservation.location.city,
          province: reservation.location.province,
          postal_code: reservation.location.postal_code,
        }
      : null,

    availability: reservation.availability
      ? {
          id: reservation.availability.id,
          appointmentDate: reservation.availability.appointment_date,
          available_from: reservation.availability.available_from,
          available_to: reservation.availability.available_to,
          service_location_info: reservation.availability.service_location_info,
        }
      : null,

    homeAddress: reservation.home_address,
    preferredDate: reservation.preferred_date,
    preferredPeriods: reservation.preferred_periods,
    confirmedDate: reservation.confirmed_date,

    preferredTimeFrom: reservation.preferred_time_from,
    preferredTimeTo: reservation.preferred_time_to,

    vehicles,
    tireRequest,

    upcomingReservations: hasValidToken ? upcomingReservations : [],
  };
}

function mapUpcomingReservations(reservations, getConfirmationUrl) {
  return (reservations || []).map((reservation) => ({
    id: reservation.id,
    status: reservation.status,

    reservationType: reservation.reservation_type,
    serviceType: reservation.service_type,

    preferredDate: reservation.preferred_date,
    confirmedDate: reservation.confirmed_date,
    homeAddress: reservation.home_address,

    company: reservation.company,
    location: reservation.location,
    availability: reservation.availability,

    confirmationUrl: getConfirmationUrl({
      reservationId: reservation.id,
      token: reservation.access_token,
      reservationType: reservation.reservation_type,
      serviceType: reservation.service_type,
    }),
  }));
}

function mapVehiclesAndTireRequest(vehicles, tireRequest) {
  return {
    vehicles,
    tireRequest,
  };
}

module.exports = {
  mapVehicles,
  mapReservation,
  mapUpcomingReservations,
  mapVehiclesAndTireRequest,
};
