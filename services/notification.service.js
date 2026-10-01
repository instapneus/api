const sgMail = require("@sendgrid/mail");
const twilio = require("twilio");

const logger = require("./logger/logger.service");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const { getConfirmationUrl } = require("../helpers/reservationUrl");

const ReservationType = require("../constants/reservationTypes");

/**
 * =========================================================
 * SAFE ERROR
 * =========================================================
 */

function getSafeError(error) {
  const sendGridError = error?.response?.body?.errors?.[0];

  return {
    providerCode: error?.code ?? sendGridError?.field ?? null,

    providerStatus:
      error?.statusCode ?? error?.status ?? error?.response?.statusCode ?? null,

    message:
      sendGridError?.message ?? error?.message ?? "Unknown notification error",
  };
}

/**
 * =========================================================
 * SAFE EMAIL
 * =========================================================
 */

async function sendEmailSafely({ message, failureCode, context = {} }) {
  try {
    const [response] = await sgMail.send(message);

    return {
      sent: true,

      messageId:
        response?.headers?.["x-message-id"] ??
        response?.headers?.["X-Message-Id"] ??
        null,

      statusCode: response?.statusCode ?? null,

      error: null,
    };
  } catch (error) {
    const safeError = getSafeError(error);

    logger.warn("Email notification failed", {
      event: failureCode,

      category: "notification",

      error,

      context: {
        provider: "sendgrid",

        channel: "email",

        ...context,

        providerError: safeError,
      },

      capture: true,
    });

    return {
      sent: false,

      messageId: null,

      error: {
        code: failureCode,

        ...safeError,
      },
    };
  }
}

/**
 * =========================================================
 * SAFE SMS
 * =========================================================
 */

async function sendSmsSafely({ message, failureCode, context = {} }) {
  try {
    const result = await twilioClient.messages.create(message);

    return {
      sent: true,

      messageId: result.sid,

      providerStatus: result.status || null,

      error: null,
    };
  } catch (error) {
    const safeError = getSafeError(error);

    logger.warn("SMS notification failed", {
      event: failureCode,

      category: "notification",

      error,

      context: {
        provider: "twilio",

        channel: "sms",

        ...context,

        providerError: safeError,
      },

      capture: true,
    });

    return {
      sent: false,

      messageId: null,

      providerStatus: null,

      error: {
        code: failureCode,

        ...safeError,
      },
    };
  }
}

/**
 * =========================================================
 * COMPANY CONFIRMATION
 * =========================================================
 */

async function sendCompanyReservationConfirmation({
  reservation,
  customer,
  company,
  location,
  availability,
}) {
  const confirmationUrl = getConfirmationUrl({
    reservationId: reservation.id,

    token: reservation.access_token,

    reservationType: ReservationType.Company,

    serviceType: availability.service_type,
  });

  const context = {
    reservationId: reservation.id,

    customerId: customer.id,

    notificationType: "company_confirmation",
  };

  const emailPromise = sendEmailSafely({
    message: {
      to: customer.email,

      from: {
        email: process.env.FROM_EMAIL,

        name: process.env.FROM_NAME,
      },

      templateId: process.env.CONFIRMATION_COMPANY_TEMPLATE_ID,

      dynamicTemplateData: {
        name: `${customer.first_name} ${customer.last_name}`,

        companyName: company.name,

        locationName: location.name,

        manageUrl: confirmationUrl,
      },
    },

    failureCode: "SENDGRID_COMPANY_CONFIRMATION_FAILED",

    context,
  });

  const smsPromise = customer.phone
    ? sendSmsSafely({
        message: {
          to: customer.phone,
          from: process.env.TWILIO_FROM_PHONE_NUMBER,
          body:
            `Instapneus\n\n` +
            `FR: Votre rendez-vous est confirmé. Cliquez sur le lien suivant pour consulter les détails : ${confirmationUrl}\n\n` +
            `EN: Your appointment is confirmed. Click the following link to view the details: ${confirmationUrl}`,
        },

        failureCode: "TWILIO_COMPANY_CONFIRMATION_FAILED",

        context,
      })
    : Promise.resolve({
        sent: false,

        skipped: true,

        reason: "NO_PHONE_NUMBER",

        messageId: null,

        error: null,
      });

  const [email, sms] = await Promise.all([emailPromise, smsPromise]);

  return {
    confirmationUrl,

    email,

    sms,

    delivered: email.sent || sms.sent,
  };
}

/**
 * =========================================================
 * COMPANY APPOINTMENT REMINDERS
 * =========================================================
 *
 * Automated reminders sent:
 *
 * - 72h before the appointment
 * - 24h before the appointment
 *
 * Email uses SendGrid dynamic templates.
 * SMS uses Twilio.
 */

async function sendCompanyAppointmentReminderEmail({
  reminderType,
  reservation,
}) {
  const { customer, company, location, availability } = reservation;

  const templateId = getCompanyReminderTemplateId(reminderType);

  if (!templateId) {
    return {
      sent: false,

      error: {
        code: "COMPANY_REMINDER_TEMPLATE_NOT_CONFIGURED",
        message: `SendGrid template is not configured for ${reminderType}`,
      },
    };
  }

  const manageUrl = getConfirmationUrl({
    reservationId: reservation.id,

    token: reservation.access_token,

    reservationType: ReservationType.Company,

    serviceType: reservation.service_type || availability?.service_type,
  });

  const appointmentDate = availability?.appointment_date;

  const appointmentDateFr = formatCompanyReminderDate(appointmentDate, "fr-CA");

  const appointmentDateEn = formatCompanyReminderDate(appointmentDate, "en-CA");

  const name = [customer?.first_name, customer?.last_name]
    .filter(Boolean)
    .join(" ");

  const context = {
    reservationId: reservation.id,

    customerId: customer?.id,

    notificationType: "company_appointment_reminder",

    reminderType,

    channel: "email",

    appointmentDate,
  };

  return sendEmailSafely({
    message: {
      to: customer.email,

      from: {
        email: process.env.FROM_EMAIL,

        name: process.env.FROM_NAME,
      },

      templateId,

      dynamicTemplateData: {
        name,

        companyName: company?.name || "",

        locationName: location?.name || "",

        appointmentDateFr,

        appointmentDateEn,

        manageUrl,
      },
    },

    failureCode: `SENDGRID_COMPANY_REMINDER_${reminderType.toUpperCase()}_FAILED`,

    context,
  });
}

/**
 * =========================================================
 * COMPANY APPOINTMENT REMINDER SMS
 * =========================================================
 */

async function sendCompanyAppointmentReminderSms({
  reminderType,
  reservation,
}) {
  const { customer, company, location, availability } = reservation;

  const manageUrl = getConfirmationUrl({
    reservationId: reservation.id,

    token: reservation.access_token,

    reservationType: ReservationType.Company,

    serviceType: reservation.service_type || availability?.service_type,
  });

  const body = buildCompanyAppointmentReminderSmsBody({
    reminderType,

    appointmentDate: availability?.appointment_date,

    companyName: company?.name || "",

    locationName: location?.name || "",

    manageUrl,
  });

  const context = {
    reservationId: reservation.id,

    customerId: customer?.id,

    notificationType: "company_appointment_reminder",

    reminderType,

    channel: "sms",

    appointmentDate: availability?.appointment_date,
  };

  return sendSmsSafely({
    message: {
      to: customer.phone,

      from: process.env.TWILIO_FROM_PHONE_NUMBER,

      body,
    },

    failureCode: `TWILIO_COMPANY_REMINDER_${reminderType.toUpperCase()}_FAILED`,

    context,
  });
}

/**
 * =========================================================
 * COMPANY REMINDER TEMPLATE
 * =========================================================
 */

function getCompanyReminderTemplateId(reminderType) {
  switch (reminderType) {
    case "72h":
      return process.env.COMPANY_REMINDER_72H_TEMPLATE_ID;

    case "24h":
      return process.env.COMPANY_REMINDER_24H_TEMPLATE_ID;

    default:
      throw new Error(`Unknown company reminder type: ${reminderType}`);
  }
}

/**
 * =========================================================
 * COMPANY REMINDER SMS BODY
 * =========================================================
 */

function buildCompanyAppointmentReminderSmsBody({
  reminderType,
  appointmentDate,
  companyName,
  locationName,
  manageUrl,
}) {
  const appointmentDateFr = formatCompanyReminderDate(appointmentDate, "fr-CA");
  const appointmentDateEn = formatCompanyReminderDate(appointmentDate, "en-CA");
  const locationLabel = [companyName, locationName].filter(Boolean).join(" — ");

  if (reminderType === "72h") {
    return (
      `Instapneus\n\n` +
      `FR: Rappel : votre rendez-vous chez ${locationLabel} est prévu le ` +
      `${appointmentDateFr}. Cliquez sur le lien suivant pour consulter les détails : ${manageUrl}\n\n` +
      `EN: Reminder: your appointment at ${locationLabel} is scheduled for ` +
      `${appointmentDateEn}. Click the following link to view the details: ${manageUrl}`
    );
  }

  if (reminderType === "24h") {
    return (
      `Instapneus\n\n` +
      `FR: Rappel : votre rendez-vous chez ${locationLabel} est demain, ` +
      `le ${appointmentDateFr}. Cliquez sur le lien suivant pour consulter les détails : ${manageUrl}\n\n` +
      `EN: Reminder: your appointment at ${locationLabel} is tomorrow, ` +
      `${appointmentDateEn}. Click the following link to view the details: ${manageUrl}`
    );
  }

  throw new Error(`Unknown company reminder type: ${reminderType}`);
}

/**
 * =========================================================
 * COMPANY REMINDER DATE
 * =========================================================
 *
 * company_availabilities.appointment_date is a date-only
 * value such as:
 *
 * 2026-10-23
 *
 * We parse date-only values manually to prevent timezone
 * conversion from changing the calendar date.
 */

function formatCompanyReminderDate(appointmentDate, locale) {
  if (!appointmentDate) {
    return "";
  }

  const value = String(appointmentDate).trim();

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  let date;

  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);

    const month = Number(dateOnlyMatch[2]);

    const day = Number(dateOnlyMatch[3]);

    /**
     * Noon UTC safely remains on the same calendar
     * date in America/Montreal.
     */
    date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",

    year: "numeric",

    month: "long",

    day: "numeric",

    timeZone: "America/Montreal",
  }).format(date);
}

/**
 * =========================================================
 * RESIDENTIAL REQUEST CREATED
 * =========================================================
 *
 * This is the existing notification sent when
 * the residential request is first submitted.
 *
 * The request is still pending at this stage.
 */

async function sendResidentialReservationConfirmation({
  serviceType,
  reservation,
  customer,
  address,
}) {
  const confirmationUrl = getConfirmationUrl({
    reservationId: reservation.id,
    token: reservation.access_token,
    reservationType: ReservationType.Residential,
    serviceType,
  });

  const context = {
    reservationId: reservation.id,
    customerId: customer.id,
    notificationType: "residential_confirmation",
  };

  const emailPromise = sendEmailSafely({
    message: {
      to: customer.email,
      from: {
        email: process.env.FROM_EMAIL,
        name: process.env.FROM_NAME,
      },
      templateId: process.env.CONFIRMATION_RESIDENTIAL_TEMPLATE_ID,
      dynamicTemplateData: {
        name: `${customer.first_name} ${customer.last_name}`,
        address,
        manageUrl: confirmationUrl,
      },
    },

    failureCode: "SENDGRID_RESIDENTIAL_CONFIRMATION_FAILED",
    context,
  });

  const smsPromise = customer.phone
    ? sendSmsSafely({
        message: {
          to: customer.phone,
          from: process.env.TWILIO_FROM_PHONE_NUMBER,
          body:
            `Instapneus\n\n` +
            `FR: Votre demande est en attente. Cliquez sur le lien suivant pour faire le suivi : ${confirmationUrl}\n\n` +
            `EN: Your request is pending. Click the following link to follow up: ${confirmationUrl}`,
        },
        failureCode: "TWILIO_RESIDENTIAL_CONFIRMATION_FAILED",
        context,
      })
    : Promise.resolve({
        sent: false,

        skipped: true,

        reason: "NO_PHONE_NUMBER",

        messageId: null,

        error: null,
      });

  const [email, sms] = await Promise.all([emailPromise, smsPromise]);

  return {
    confirmationUrl,

    email,

    sms,

    delivered: email.sent || sms.sent,
  };
}

/**
 * =========================================================
 * RESIDENTIAL CONFIRMED DATE SMS
 * =========================================================
 *
 * Called ONLY after customer service explicitly
 * chooses to notify the customer.
 *
 * This is NOT called automatically when somebody
 * changes the Google Sheet status.
 *
 *
 * Required:
 *
 * reservation_type = residential
 * status = confirmed
 * confirmed_date exists
 * customer.phone exists
 */

async function sendResidentialConfirmedDateSms({ reservation, customer }) {
  if (!reservation || !reservation.id) {
    throw new Error("Reservation is required");
  }

  if (
    String(reservation.reservation_type || "")
      .trim()
      .toLowerCase() !== "residential"
  ) {
    return {
      sent: false,

      skipped: true,

      reason: "NOT_RESIDENTIAL",

      messageId: null,

      error: null,
    };
  }

  /**
   * Defensive protection.
   *
   * Even if an old Google Sheet link/button exists,
   * we don't send unless Supabase itself says
   * the reservation is confirmed.
   */

  if (
    String(reservation.status || "")
      .trim()
      .toLowerCase() !== "confirmed"
  ) {
    return {
      sent: false,

      skipped: true,

      reason: "RESERVATION_NOT_CONFIRMED",

      messageId: null,

      error: null,
    };
  }

  if (!reservation.confirmed_date) {
    return {
      sent: false,

      skipped: true,

      reason: "CONFIRMED_DATE_REQUIRED",

      messageId: null,

      error: null,
    };
  }

  if (!customer?.phone) {
    return {
      sent: false,

      skipped: true,

      reason: "NO_PHONE_NUMBER",

      messageId: null,

      error: null,
    };
  }

  const confirmationUrl = getConfirmationUrl({
    reservationId: reservation.id,

    token: reservation.access_token,

    reservationType: ReservationType.Residential,

    serviceType: reservation.service_type,
  });

  const body = buildResidentialConfirmedDateSmsBody({
    confirmedDate: reservation.confirmed_date,

    confirmationUrl,
  });

  const context = {
    reservationId: reservation.id,

    customerId: customer.id,

    notificationType: "residential_date_confirmed",

    confirmedDate: reservation.confirmed_date,
  };

  const sms = await sendSmsSafely({
    message: {
      to: customer.phone,

      from: process.env.TWILIO_FROM_PHONE_NUMBER,

      body,
    },

    failureCode: "TWILIO_RESIDENTIAL_DATE_CONFIRMED_FAILED",

    context,
  });

  return {
    ...sms,

    confirmationUrl,

    confirmedDate: reservation.confirmed_date,
  };
}

/**
 * =========================================================
 * RESIDENTIAL CONFIRMED DATE MESSAGE
 * =========================================================
 */

function buildResidentialConfirmedDateSmsBody({
  confirmedDate,
  confirmationUrl,
}) {
  const formattedDate = formatConfirmedDateForSms(confirmedDate);

  return (
    `Instapneus\n\n` +
    `FR: Votre rendez-vous à domicile est confirmé pour le ${formattedDate.fr}. ` +
    `Cliquez sur le lien suivant pour consulter les détails : ${confirmationUrl}\n\n` +
    `EN: Your home appointment is confirmed for ${formattedDate.en}. ` +
    `Click the following link to view the details: ${confirmationUrl}`
  );
}

/**
 * =========================================================
 * RESIDENTIAL DATE FORMATTING
 * =========================================================
 *
 * Input:
 *
 * 2026-08-25
 *
 * Output:
 *
 * FR: 25 août 2026
 * EN: August 25, 2026
 *
 *
 * UTC is deliberately used to avoid a date shifting
 * by one day because of the server timezone.
 */

function formatConfirmedDateForSms(confirmedDate) {
  const value = String(confirmedDate || "")
    .trim()
    .substring(0, 10);

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    throw new Error("Invalid confirmed residential date");
  }

  const year = Number(match[1]);

  const month = Number(match[2]);

  const day = Number(match[3]);

  const date = new Date(Date.UTC(year, month - 1, day));

  const isValid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!isValid) {
    throw new Error("Invalid confirmed residential date");
  }

  const fr = new Intl.DateTimeFormat("fr-CA", {
    day: "numeric",

    month: "long",

    year: "numeric",

    timeZone: "UTC",
  }).format(date);

  const en = new Intl.DateTimeFormat("en-CA", {
    day: "numeric",

    month: "long",

    year: "numeric",

    timeZone: "UTC",
  }).format(date);

  return {
    fr,
    en,
  };
}

/**
 * =========================================================
 * CANCELLATION
 * =========================================================
 */

async function sendCancellationConfirmation({ reservation, customer }) {
  const confirmationUrl = getConfirmationUrl({
    reservationId: reservation.id,

    token: reservation.access_token,

    reservationType: reservation.reservation_type,

    serviceType: reservation.service_type,
  });

  const context = {
    reservationId: reservation.id,

    customerId: customer.id,

    notificationType: "company_confirmation",
  };

  const emailPromise = sendEmailSafely({
    message: {
      to: customer.email,

      from: {
        email: process.env.FROM_EMAIL,

        name: process.env.FROM_NAME,
      },

      templateId: process.env.CONFIRMATION_CANCELLATION_TEMPLATE_ID,

      dynamicTemplateData: {
        name: `${customer.first_name} ${customer.last_name}`,

        manageUrl: confirmationUrl,
      },
    },

    failureCode: "SENDGRID_CANCELLATION_FAILED",

    context,
  });

  const smsPromise = customer.phone
    ? sendSmsSafely({
        message: {
          to: customer.phone,
          from: process.env.TWILIO_FROM_PHONE_NUMBER,
          body:
            `Instapneus\n\n` +
            `FR: Votre réservation a été annulée. Cliquez sur le lien suivant pour consulter les détails : ${confirmationUrl}\n\n` +
            `EN: Your appointment has been cancelled. Click the following link to view the details: ${confirmationUrl}`,
        },

        failureCode: "TWILIO_CANCELLATION_FAILED",

        context,
      })
    : Promise.resolve({
        sent: false,
        skipped: true,
        reason: "NO_PHONE_NUMBER",
        messageId: null,
        error: null,
      });

  const [email, sms] = await Promise.all([emailPromise, smsPromise]);

  return {
    confirmationUrl,
    email,
    sms,
    delivered: email.sent || sms.sent,
  };
}

/**
 * =========================================================
 * WAITLIST
 * =========================================================
 */

async function sendWaitlistAvailabilitySms({ waitlistEntry, availability }) {
  if (!waitlistEntry.phone) {
    return {
      sent: false,
      skipped: true,
      reason: "NO_PHONE_NUMBER",
      messageId: null,
      error: null,
    };
  }

  const bookingUrl = `${process.env.FRONTEND_URL}/company/inscription`;

  const body =
    `Instapneus\n\n` +
    `FR: Une place vient de se libérer pour une date où vous étiez sur la liste d'attente. Premier arrivé, premier servi.\n` +
    `Réserver: ${bookingUrl}\n\n` +
    `EN: A spot is now available for a date where you joined the waiting list. First come, first served.\n` +
    `Book: ${bookingUrl}`;

  return sendSmsSafely({
    message: {
      to: waitlistEntry.phone,
      from: process.env.TWILIO_FROM_PHONE_NUMBER,
      body,
    },
    failureCode: "TWILIO_WAITLIST_AVAILABILITY_FAILED",
    context: {
      waitlistEntryId: waitlistEntry.id,
      availabilityId: availability.id,
      notificationType: "waitlist_availability",
    },
  });
}

/**
 * =========================================================
 * NEW TIRE REQUEST EMAIL
 * =========================================================
 *
 * Internal notification sent after a brand-new tire request
 * has successfully been inserted into the Google Sheet.
 */

async function sendNewTireRequestNotification({
  tirePurchaseRequestId,
  source,
  requestDate,
  name,
  phone,
  email,
  vehicle,
  location,
  request,
  notes,
  sheetUrl,
}) {
  const recipient = process.env.TIRE_REQUEST_NOTIFICATION_EMAIL;

  if (!recipient) {
    return {
      sent: false,
      skipped: true,
      reason: "TIRE_REQUEST_NOTIFICATION_EMAIL_NOT_CONFIGURED",
      error: null,
    };
  }

  const sourceLabel = getTireRequestSourceLabel(source);

  const formattedDate = formatTireRequestNotificationDate(requestDate);

  const subject = `Nouvelle demande de pneus — ${name || "Client"}`;

  const html = `
    <div
      style="
        font-family: Arial, sans-serif;
        color: #222222;
        max-width: 650px;
        margin: 0 auto;
      "
    >
      <h2 style="margin-bottom: 8px;">
        Nouvelle demande de pneus
      </h2>

      <p style="margin-top: 0; color: #666666;">
        Une nouvelle demande de pneus a été ajoutée dans
        <strong>Nouveau demande de pneus</strong>.
      </p>

      <table
        cellpadding="8"
        cellspacing="0"
        style="
          border-collapse: collapse;
          width: 100%;
          margin-top: 20px;
        "
      >
        ${buildTireRequestEmailRow("Source", sourceLabel)}

        ${buildTireRequestEmailRow("Date", formattedDate)}

        ${buildTireRequestEmailRow("Client", name)}

        ${buildTireRequestEmailRow("Téléphone", phone)}

        ${buildTireRequestEmailRow("Courriel", email)}

        ${buildTireRequestEmailRow("Véhicule", vehicle)}

        ${buildTireRequestEmailRow("Emplacement", location)}

        ${buildTireRequestEmailRow("Demande", request)}

        ${buildTireRequestEmailRow("Notes", notes)}
      </table>

      ${
        sheetUrl
          ? `
            <div style="margin-top: 24px;">
              <a
                href="${escapeTireRequestEmailHtml(sheetUrl)}"
                style="
                  display: inline-block;
                  background-color: #f47b20;
                  color: #ffffff;
                  text-decoration: none;
                  padding: 12px 18px;
                  border-radius: 5px;
                  font-weight: bold;
                "
              >
                Voir les demandes de pneus
              </a>
            </div>
          `
          : ""
      }

      <p
        style="
          margin-top: 24px;
          font-size: 12px;
          color: #999999;
        "
      >
        ID demande :
        ${escapeTireRequestEmailHtml(tirePurchaseRequestId || "—")}
      </p>
    </div>
  `;

  const text = [
    "Nouvelle demande de pneus",
    "",
    `Source: ${sourceLabel || "—"}`,
    `Date: ${formattedDate || "—"}`,
    `Client: ${name || "—"}`,
    `Téléphone: ${phone || "—"}`,
    `Courriel: ${email || "—"}`,
    `Véhicule: ${vehicle || "—"}`,
    `Emplacement: ${location || "—"}`,
    `Demande: ${request || "—"}`,
    `Notes: ${notes || "—"}`,
    "",
    sheetUrl ? `Google Sheet: ${sheetUrl}` : "",
    `ID demande: ${tirePurchaseRequestId || "—"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return sendEmailSafely({
    message: {
      to: recipient,

      from: {
        email: process.env.FROM_EMAIL,
        name: process.env.FROM_NAME,
      },

      subject,

      text,

      html,
    },

    failureCode: "SENDGRID_NEW_TIRE_REQUEST_NOTIFICATION_FAILED",

    context: {
      tirePurchaseRequestId,

      notificationType: "new_tire_request",

      source,

      recipient,
    },
  });
}

/**
 * =========================================================
 * TIRE REQUEST EMAIL SOURCE
 * =========================================================
 */

function getTireRequestSourceLabel(source) {
  switch (
    String(source || "")
      .trim()
      .toLowerCase()
  ) {
    case "company_reservation":
      return "Réservation entreprise";

    case "residential_reservation":
      return "Réservation résidentielle";

    case "standalone":
    case "standalone_tire_estimate":
    case "tire_estimate":
      return "Demande de pneus en ligne";

    default:
      return source || "Demande de pneus";
  }
}

/**
 * =========================================================
 * TIRE REQUEST EMAIL DATE
 * =========================================================
 */

function formatTireRequestNotificationDate(requestDate) {
  if (!requestDate) {
    return "";
  }

  const date = new Date(requestDate);

  if (Number.isNaN(date.getTime())) {
    return String(requestDate);
  }

  return new Intl.DateTimeFormat("fr-CA", {
    dateStyle: "long",

    timeStyle: "short",

    timeZone: "America/Montreal",
  }).format(date);
}

/**
 * =========================================================
 * TIRE REQUEST EMAIL ROW
 * =========================================================
 */

function buildTireRequestEmailRow(label, value) {
  const formattedValue = value
    ? escapeTireRequestEmailHtml(value).replace(/\r?\n/g, "<br>")
    : "—";

  return `
    <tr>
      <td
        style="
          width: 150px;
          font-weight: bold;
          vertical-align: top;
          border-bottom: 1px solid #dddddd;
        "
      >
        ${escapeTireRequestEmailHtml(label)}
      </td>

      <td
        style="
          vertical-align: top;
          border-bottom: 1px solid #dddddd;
        "
      >
        ${formattedValue}
      </td>
    </tr>
  `;
}

/**
 * =========================================================
 * TIRE REQUEST EMAIL HTML ESCAPE
 * =========================================================
 */

function escapeTireRequestEmailHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * =========================================================
 * VEHICLE READY SMS
 * =========================================================
 */

async function sendVehicleReadySms({
  phone,
  vehicleLabel,
  body = null,
  statusCallback = null,
  context = {},
}) {
  if (!phone) {
    return {
      sent: false,
      skipped: true,
      reason: "NO_PHONE_NUMBER",
      messageId: null,
      providerStatus: null,
      error: null,
    };
  }

  const smsBody = body || buildVehicleReadySmsBody(vehicleLabel);

  const message = {
    to: phone,
    from: process.env.TWILIO_FROM_PHONE_NUMBER,
    body: smsBody,
  };

  if (statusCallback) {
    message.statusCallback = statusCallback;
  }

  console.log("Vehicle ready Twilio payload:", {
    to: message.to,
    from: message.from,
    body: message.body,
    statusCallback: message.statusCallback,
    keys: Object.keys(message),
  });

  return sendSmsSafely({
    message,
    failureCode: "TWILIO_VEHICLE_READY_FAILED",
    context: {
      ...context,
      notificationType: "vehicle_ready",
      vehicleLabel,
    },
  });
}

/**
 * =========================================================
 * VEHICLE READY SMS BODY
 * =========================================================
 */

function buildVehicleReadySmsBody(vehicleLabel) {
  if (!vehicleLabel) {
    throw new Error("vehicleLabel is required to build a vehicle ready SMS");
  }

  return (
    `Instapneus\n\n` +
    `FR: Votre véhicule ${vehicleLabel} est maintenant prêt. ` +
    `Vous pouvez venir le récupérer. Merci.\n\n` +
    `EN: Your vehicle ${vehicleLabel} is now ready. ` +
    `You may come pick it up. Thank you.`
  );
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  sendCompanyReservationConfirmation,
  sendResidentialReservationConfirmation,
  sendResidentialConfirmedDateSms,
  sendCompanyAppointmentReminderEmail,
  sendCompanyAppointmentReminderSms,
  buildResidentialConfirmedDateSmsBody,
  sendCancellationConfirmation,
  sendWaitlistAvailabilitySms,
  sendVehicleReadySms,
  buildVehicleReadySmsBody,
  sendNewTireRequestNotification,
};
