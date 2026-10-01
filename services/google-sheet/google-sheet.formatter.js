/**
 * =========================================================
 * TEXT NORMALIZATION
 * =========================================================
 */

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * =========================================================
 * TECHNICIAN QUESTION FORMATTERS
 * =========================================================
 */

const TECHNICIAN_QUESTION_FORMATTERS = {
  /**
   * question.code = "balancing"
   *
   * Oui  -> Avec balancement
   * Non  -> Sans balancement
   */
  balancing: ({ values }) => {
    const value = normalizeText(values[0]);

    const isYes =
      value === "oui" || value === "yes" || value === "true" || value === "1";

    return isYes ? "Avec balancement" : "Sans balancement";
  },

  /**
   * question.code = "engine_size"
   *
   * Exemple:
   *
   * 2.0L
   * ->
   * Moteur : 2.0L
   */
  engine_size: ({ values }) => {
    return `Moteur : ${values.join(", ")}`;
  },
};

/**
 * =========================================================
 * PHONE
 * =========================================================
 */

function formatPhone(phone) {
  if (!phone) {
    return "";
  }

  const digits = String(phone).replace(/\D/g, "");

  const normalized =
    digits.length === 11 && digits.startsWith("1")
      ? digits.substring(1)
      : digits;

  if (normalized.length !== 10) {
    return phone;
  }

  return normalized.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3");
}

/**
 * =========================================================
 * TIME
 * =========================================================
 */

function formatTime(time) {
  if (!time) {
    return "";
  }

  const [hoursValue, minutesValue] = String(time).split(":");

  const hours = Number(hoursValue);
  const minutes = Number(minutesValue);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return time;
  }

  return `${hours}h${String(minutes).padStart(2, "0")}`;
}

/**
 * =========================================================
 * COMPANY AVAILABILITY
 * =========================================================
 */

function formatAvailability(from, to) {
  if (!from && !to) {
    return "";
  }

  if (from && !to) {
    return `À partir de ${formatTime(from)}`;
  }

  if (!from && to) {
    return `Jusqu'à ${formatTime(to)}`;
  }

  return `${formatTime(from)} à ${formatTime(to)}`;
}

/**
 * =========================================================
 * VEHICLE
 * =========================================================
 */

function formatVehicleName(vehicle) {
  return [vehicle.year, vehicle.brand, vehicle.model, vehicle.color]
    .filter(Boolean)
    .join(" ");
}

/**
 * =========================================================
 * SERVICE NAME
 * =========================================================
 */

function getServiceName(selectedService) {
  const service = selectedService?.service;

  if (!service) {
    return "";
  }

  return (
    service.name_fr || service.name || service.name_en || service.code || ""
  );
}

/**
 * =========================================================
 * QUESTION LABEL
 * =========================================================
 */

function getQuestionLabel(answer) {
  const question = answer?.question;

  if (!question) {
    return "";
  }

  return question.label_fr || question.label_en || question.code || "";
}

/**
 * =========================================================
 * ANSWER VALUE
 * =========================================================
 */

function getAnswerValue(answer) {
  if (!answer) {
    return "";
  }

  /**
   * Radio / Select / Checkbox option.
   */
  if (answer.option) {
    return (
      answer.option.label_fr ||
      answer.option.label_en ||
      answer.option.code ||
      ""
    );
  }

  /**
   * Text.
   */
  if (answer.value_text !== null && answer.value_text !== undefined) {
    return String(answer.value_text).trim();
  }

  /**
   * Number.
   *
   * 0 is valid.
   */
  if (answer.value_number !== null && answer.value_number !== undefined) {
    return String(answer.value_number);
  }

  /**
   * Boolean.
   */
  if (answer.value_boolean !== null && answer.value_boolean !== undefined) {
    return answer.value_boolean ? "Oui" : "Non";
  }

  return "";
}

/**
 * =========================================================
 * TECHNICIAN QUESTION
 * =========================================================
 */

function formatQuestionForTechnician({ question, label, values }) {
  const code = question?.code;

  if (code) {
    const formatter = TECHNICIAN_QUESTION_FORMATTERS[code];

    if (formatter) {
      return formatter({
        question,
        values,
      });
    }
  }

  return `${label} : ${values.join(", ")}`;
}

/**
 * =========================================================
 * SERVICE ANSWERS
 * =========================================================
 */

function formatServiceAnswers(answers = []) {
  const groupedQuestions = new Map();

  for (const answer of answers) {
    const question = answer.question;

    if (!question) {
      continue;
    }

    const questionLabel = getQuestionLabel(answer);

    const answerValue = getAnswerValue(answer);

    if (!questionLabel || !answerValue) {
      continue;
    }

    const questionKey = question.id || question.code || questionLabel;

    if (!groupedQuestions.has(questionKey)) {
      groupedQuestions.set(questionKey, {
        question,
        label: questionLabel,
        values: [],
      });
    }

    const group = groupedQuestions.get(questionKey);

    if (!group.values.includes(answerValue)) {
      group.values.push(answerValue);
    }
  }

  return Array.from(groupedQuestions.values())
    .map(formatQuestionForTechnician)
    .filter(Boolean)
    .join(" | ");
}

/**
 * =========================================================
 * SELECTED SERVICE
 * =========================================================
 */

function formatSelectedService(selectedService) {
  const serviceName = getServiceName(selectedService);

  if (!serviceName) {
    return "";
  }

  const answerDetails = formatServiceAnswers(selectedService.answers || []);

  if (!answerDetails) {
    return `• ${serviceName}`;
  }

  return `• ${serviceName} — ${answerDetails}`;
}

/**
 * =========================================================
 * VEHICLE SERVICES
 * =========================================================
 *
 * Example:
 *
 * 2018 Nissan Versa Noir
 * • Installation complète
 * • Changement d'huile — Moteur : 2.0L
 */

function formatVehicleServices(vehicle) {
  const vehicleName = formatVehicleName(vehicle);

  const services = (vehicle.selected_services || [])
    .map(formatSelectedService)
    .filter(Boolean)
    .join("\n");

  return [vehicleName, services].filter(Boolean).join("\n");
}

/**
 * =========================================================
 * MULTIPLE VEHICLES
 * =========================================================
 *
 * Residential uses ONE Google Sheet row
 * per reservation.
 *
 * Every vehicle and its requested services
 * are therefore combined into one cell.
 */

function formatAllVehicleServices(vehicles = []) {
  return vehicles.map(formatVehicleServices).filter(Boolean).join("\n\n");
}

function formatAllVehicleComments(vehicles = []) {
  return vehicles
    .map(function (vehicle) {
      const comment = String(vehicle?.comments || "").trim();

      if (!comment) {
        return "";
      }

      const vehicleName = formatVehicleName(vehicle);

      return vehicleName ? `${vehicleName} : ${comment}` : comment;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * =========================================================
 * CUSTOMER NAME
 * =========================================================
 */

function formatCustomerName(customer) {
  return [customer?.first_name, customer?.last_name].filter(Boolean).join(" ");
}

/**
 * =========================================================
 * ADDRESS
 * =========================================================
 */

function formatAddress(address) {
  if (!address) {
    return "";
  }

  if (typeof address === "string") {
    return address.trim();
  }

  if (typeof address !== "object") {
    return String(address);
  }

  if (address.formattedAddress) {
    return String(address.formattedAddress).trim();
  }

  if (address.formatted_address) {
    return String(address.formatted_address).trim();
  }

  if (address.fullAddress) {
    return String(address.fullAddress).trim();
  }

  if (address.full_address) {
    return String(address.full_address).trim();
  }

  const street = [
    address.civicNumber ||
      address.civic_number ||
      address.street_number ||
      address.number,

    address.street || address.street_name || address.address,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    street,

    address.unit ? `App. ${address.unit}` : "",

    address.city,

    address.province,

    address.postalCode || address.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * =========================================================
 * PREFERRED DATE
 * =========================================================
 */

function formatPreferredDate(value) {
  if (!value) {
    return "";
  }

  const text = String(value).trim();

  /**
   * Postgres DATE:
   *
   * 2026-10-15
   */
  const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;

    return `${day}/${month}/${year}`;
  }

  /**
   * ISO timestamp.
   */
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})T/);

  if (isoMatch) {
    const [, year, month, day] = isoMatch;

    return `${day}/${month}/${year}`;
  }

  return text;
}

/**
 * =========================================================
 * PREFERRED PERIODS
 * =========================================================
 */

function formatPreferredPeriods(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map(function (period) {
        if (typeof period === "string") {
          return period;
        }

        if (period && typeof period === "object") {
          return (
            period.label_fr ||
            period.label ||
            period.name ||
            period.value ||
            period.code ||
            JSON.stringify(period)
          );
        }

        return String(period);
      })
      .join(", ");
  }

  if (typeof value === "object") {
    return (
      value.label_fr ||
      value.label ||
      value.name ||
      value.value ||
      value.code ||
      JSON.stringify(value)
    );
  }

  return String(value);
}

/**
 * =========================================================
 * COMPANY FORMATTER
 * =========================================================
 *
 * ONE Google Sheet row per vehicle.
 *
 * Existing technician behavior remains unchanged.
 */

function formatReservationForGoogleSheet(reservation) {
  const commonData = {
    reservationId: reservation.id,
    reservationStatus: reservation.status || "",
    name: formatCustomerName(reservation.customer),
    phone: formatPhone(reservation.customer?.phone),
    availability: formatAvailability(
      reservation.preferred_time_from,
      reservation.preferred_time_to
    ),
    email: reservation.customer?.email || "",
  };

  return (reservation.vehicles || []).map(function (vehicle) {
    return {
      ...commonData,
      reservationVehicleId: vehicle.id,
      services: formatVehicleServices(vehicle),
      /**
       * Customer comment associated with THIS vehicle.
       */
      notes: String(vehicle.comments || "").trim(),
      lastSyncedAt: new Date().toISOString(),
    };
  });
}

/**
 * =========================================================
 * RESIDENTIAL FORMATTER
 * =========================================================
 *
 * ONE Google Sheet row per reservation.
 *
 * Final columns supplied by Node:
 *
 * D  Nom
 * E  Téléphone
 * F  Courriel
 * G  Adresse
 * H  Services demandés
 * I  Notes
 * J  Date préférée
 * K  Préférence heures / période
 * L  ID réservation
 * M  Dernière synchronisation
 *
 *
 * A-C are NOT included because Apps Script owns
 * and preserves:
 *
 * A Statut du suivi
 * B Date confirmée
 * C Responsable
 */

function formatResidentialReservationForGoogleSheet(reservation) {
  if (!reservation || !reservation.id) {
    throw new Error("Réservation résidentielle invalide.");
  }

  return {
    reservationId: reservation.id,
    reservationStatus: reservation.status || "",
    /**
     * Customer.
     */
    name: formatCustomerName(reservation.customer),
    phone: formatPhone(reservation.customer?.phone),
    email: reservation.customer?.email || "",
    /**
     * Residential address.
     */
    address: formatAddress(reservation.address || reservation.home_address),
    /**
     * All vehicles and all selected services
     * in ONE cell.
     *
     * Oil change appears here automatically
     * when selected.
     */
    services: formatAllVehicleServices(reservation.vehicles || []),
    /**
     * Reserved for an actual customer/request
     * note when we connect one later.
     */
    notes:
      reservation.notes || formatAllVehicleComments(reservation.vehicles || []),
    preferredDate: formatPreferredDate(
      reservation.preferred_date || reservation.preferredDate
    ),
    preferredPeriod: formatPreferredPeriods(
      reservation.preferred_periods || reservation.preferredPeriods
    ),
    lastSyncedAt: new Date().toISOString(),
  };
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  formatReservationForGoogleSheet,
  formatResidentialReservationForGoogleSheet,
};
