const notificationRepository = require("./reservation-notification.repository");

const {
  sendVehicleReadySms,
  buildVehicleReadySmsBody,
} = require("../notification.service");

/**
 * =========================================================
 * SEND VEHICLE READY NOTIFICATION
 * =========================================================
 *
 * One vehicle = one independent ready notification.
 *
 * The phone number provided here comes directly
 * from Google Sheets.
 */
async function sendVehicleReadyNotification({
  reservationId,
  reservationVehicleId,
  phone,
  vehicleLabel,
  technician = null,
  spreadsheetId = null,
  sheetTab = null,
}) {
  /**
   * =====================================
   * VALIDATION
   * =====================================
   */
  if (!reservationId) {
    throw new Error("reservationId is required");
  }

  if (!reservationVehicleId) {
    throw new Error("reservationVehicleId is required");
  }

  if (!phone) {
    throw new Error("phone is required");
  }

  if (!vehicleLabel) {
    throw new Error("vehicleLabel is required");
  }

  /**
   * =====================================
   * NORMALIZE PHONE NUMBER
   * =====================================
   *
   * The technician may enter:
   *
   * (514) 604-3712
   * 514-604-3712
   * 514 604 3712
   * 5146043712
   * 1-514-604-3712
   * +1 514 604 3712
   *
   * All of those become:
   *
   * +15146043712
   */
  const normalizedPhone = normalizeSmsPhoneNumber(phone);

  /**
   * If the number cannot safely
   * be converted to an SMS number,
   * do NOT send anything.
   *
   * sendVehicleReadyBatch() catches this
   * error for this vehicle only, so the
   * rest of the batch can continue.
   */
  if (!normalizedPhone) {
    throw new Error(`Invalid SMS phone number: ${phone}`);
  }

  /**
   * =====================================
   * DUPLICATE CHECK
   * =====================================
   *
   * If this vehicle already has:
   *
   * pending
   * accepted
   * delivered
   *
   * we do NOT send another normal
   * vehicle-ready message.
   */
  const existingNotification =
    await notificationRepository.findActiveVehicleReadyNotification(
      reservationVehicleId
    );

  if (existingNotification) {
    return {
      sent: false,
      skipped: true,
      reason: "VEHICLE_ALREADY_NOTIFIED",

      notification: existingNotification,
    };
  }

  /**
   * Build the exact message BEFORE sending.
   *
   * The same string will be:
   *
   * 1. saved in Supabase
   * 2. sent through Twilio
   */
  const message = buildVehicleReadySmsBody(vehicleLabel);

  /**
   * =====================================
   * CREATE PENDING ATTEMPT
   * =====================================
   *
   * We create the DB record first.
   *
   * The unique partial index in Supabase
   * protects us if two requests arrive
   * at almost the same time.
   */
  let notification;

  try {
    notification = await notificationRepository.createNotificationAttempt({
      reservationId,
      reservationVehicleId,

      type: "vehicle_ready",

      templateCode: "vehicle_ready",

      vehicleLabel,
      technician,
      spreadsheetId,
      sheetTab,

      /**
       * IMPORTANT:
       *
       * Store the exact normalized number
       * that will actually be sent to Twilio.
       */
      recipientPhone: normalizedPhone,

      message,
    });
  } catch (error) {
    /**
     * PostgreSQL unique violation.
     *
     * Another request probably created
     * the notification between our
     * duplicate check and insert.
     *
     * We treat that as "already notified"
     * rather than an application error.
     */
    if (error?.code === "23505") {
      const existing =
        await notificationRepository.findActiveVehicleReadyNotification(
          reservationVehicleId
        );

      return {
        sent: false,
        skipped: true,
        reason: "VEHICLE_ALREADY_NOTIFIED",
        notification: existing,
      };
    }

    throw error;
  }

  /**
   * =====================================
   * SEND THROUGH TWILIO
   * =====================================
   *
   * IMPORTANT:
   *
   * We send normalizedPhone,
   * NOT the raw value from Google Sheets.
   */
  const smsResult = await sendVehicleReadySms({
    phone: normalizedPhone,

    vehicleLabel,

    body: message,

    statusCallback: process.env.TWILIO_MESSAGE_STATUS_CALLBACK_URL,

    context: {
      reservationId,
      reservationVehicleId,
      notificationId: notification.id,
      technician,
    },
  });

  /**
   * =====================================
   * IMMEDIATE TWILIO FAILURE
   * =====================================
   */
  if (!smsResult.sent) {
    const failedNotification =
      await notificationRepository.markNotificationFailed({
        notificationId: notification.id,

        providerStatus: smsResult.providerStatus || null,

        providerErrorCode: smsResult.error?.providerCode || null,

        providerErrorMessage:
          smsResult.error?.message || "SMS could not be sent",
      });

    return {
      sent: false,
      skipped: false,

      notification: failedNotification,

      sms: smsResult,
    };
  }

  /**
   * =====================================
   * TWILIO ACCEPTED
   * =====================================
   *
   * IMPORTANT:
   *
   * accepted != delivered
   *
   * Later the Twilio status webhook
   * will change this to:
   *
   * delivered
   * or
   * failed
   */
  const acceptedNotification =
    await notificationRepository.markNotificationAccepted({
      notificationId: notification.id,

      providerMessageSid: smsResult.messageId,

      providerStatus: smsResult.providerStatus,
    });

  return {
    sent: true,
    skipped: false,

    notification: acceptedNotification,

    sms: smsResult,
  };
}

/**
 * =========================================================
 * SEND VEHICLE READY BATCH
 * =========================================================
 *
 * Called by the Google Sheet when the
 * technician decides to notify all
 * currently finished vehicles.
 *
 * The Sheet can send all finished rows
 * every time.
 *
 * Duplicate protection happens in
 * sendVehicleReadyNotification().
 */
async function sendVehicleReadyBatch({
  vehicles,
  technician = null,
  spreadsheetId = null,
  sheetTab = null,
}) {
  if (!Array.isArray(vehicles)) {
    throw new Error("vehicles must be an array");
  }

  const results = [];

  /**
   * Sequential on purpose for now.
   *
   * Technician batches will normally
   * be relatively small and this keeps
   * the behavior predictable.
   *
   * It also means one vehicle finishes
   * processing before we start another.
   */
  for (const vehicle of vehicles) {
    try {
      const result = await sendVehicleReadyNotification({
        reservationId: vehicle.reservationId,

        reservationVehicleId: vehicle.reservationVehicleId,

        /**
         * This is the phone number
         * read from Google Sheets.
         *
         * sendVehicleReadyNotification()
         * will normalize it before
         * storing/sending it.
         */
        phone: vehicle.phone,

        vehicleLabel: vehicle.vehicleLabel,

        technician,
        spreadsheetId,
        sheetTab,
      });

      results.push({
        reservationId: vehicle.reservationId,

        reservationVehicleId: vehicle.reservationVehicleId,

        /**
         * Keep the original Sheet value
         * in the batch response because
         * it is useful for troubleshooting.
         *
         * The notification record itself
         * stores the normalized value.
         */
        phone: vehicle.phone,

        vehicleLabel: vehicle.vehicleLabel,

        ...result,
      });
    } catch (error) {
      /**
       * IMPORTANT:
       *
       * One bad vehicle / number should
       * not prevent the rest of the batch
       * from being processed.
       *
       * Example:
       *
       * Vehicle A → valid → sends
       * Vehicle B → invalid phone → fails
       * Vehicle C → valid → sends
       */
      results.push({
        reservationId: vehicle.reservationId,

        reservationVehicleId: vehicle.reservationVehicleId,

        phone: vehicle.phone,

        vehicleLabel: vehicle.vehicleLabel,

        sent: false,
        skipped: false,

        error: {
          message: error.message || "Unknown batch notification error",
        },
      });
    }
  }

  /**
   * Useful summary for the technician.
   *
   * Example:
   *
   * {
   *   total: 8,
   *   sent: 3,
   *   skipped: 4,
   *   failed: 1
   * }
   */
  const summary = {
    total: results.length,

    sent: results.filter((item) => item.sent === true).length,

    skipped: results.filter((item) => item.skipped === true).length,

    failed: results.filter(
      (item) => item.sent !== true && item.skipped !== true
    ).length,
  };

  return {
    summary,
    results,
  };
}

/**
 * =========================================================
 * HANDLE TWILIO MESSAGE STATUS
 * =========================================================
 *
 * Twilio calls this asynchronously after
 * an outbound SMS changes status.
 *
 * Examples:
 *
 * queued
 * sending
 * sent
 * delivered
 * failed
 * undelivered
 */
async function handleTwilioMessageStatus({
  messageSid,
  messageStatus,
  errorCode = null,
  errorMessage = null,
}) {
  if (!messageSid) {
    throw new Error("Twilio MessageSid is required");
  }

  if (!messageStatus) {
    throw new Error("Twilio MessageStatus is required");
  }

  /**
   * Make sure this SID actually belongs
   * to one of our tracked notifications.
   */
  const existingNotification =
    await notificationRepository.getNotificationByProviderMessageSid(
      messageSid
    );

  /**
   * This can happen if Twilio sends
   * a callback for another type of SMS
   * such as:
   *
   * - confirmation SMS
   * - cancellation SMS
   * - waitlist SMS
   *
   * Those messages are currently not stored
   * in reservation_notifications.
   *
   * So we simply ignore them.
   */
  if (!existingNotification) {
    return {
      updated: false,
      ignored: true,
      reason: "NOTIFICATION_NOT_TRACKED",
    };
  }

  /**
   * =====================================
   * MAP TWILIO → OUR STATUS
   * =====================================
   *
   * Our simplified statuses:
   *
   * accepted
   * delivered
   * failed
   *
   * Twilio may have intermediate statuses
   * such as:
   *
   * queued
   * sending
   * sent
   *
   * We keep those as "accepted" while
   * storing the raw Twilio value separately
   * in provider_status.
   */
  let status = "accepted";

  if (messageStatus === "delivered") {
    status = "delivered";
  }

  if (messageStatus === "failed" || messageStatus === "undelivered") {
    status = "failed";
  }

  const notification = await notificationRepository.updateProviderStatus({
    providerMessageSid: messageSid,

    providerStatus: messageStatus,

    status,

    providerErrorCode: errorCode,

    providerErrorMessage: errorMessage,
  });

  return {
    updated: true,
    ignored: false,
    notification,
  };
}

/**
 * =========================================================
 * NORMALIZE SMS PHONE NUMBER
 * =========================================================
 *
 * Converts numbers entered by technicians
 * in Google Sheets into E.164 format.
 *
 * =========================================================
 * CANADA / US EXAMPLES
 * =========================================================
 *
 * (514) 604-3712
 * 514-604-3712
 * 514 604 3712
 * 514.604.3712
 * 5146043712
 *
 * become:
 *
 * +15146043712
 *
 *
 * 1-514-604-3712
 * 1 514 604 3712
 * +1 514 604 3712
 *
 * also become:
 *
 * +15146043712
 *
 *
 * =========================================================
 * INTERNATIONAL
 * =========================================================
 *
 * Explicit international numbers are
 * accepted only when they begin with +.
 *
 * Example:
 *
 * +33 6 12 34 56 78
 *
 * becomes:
 *
 * +33612345678
 *
 *
 * =========================================================
 * INVALID NUMBERS
 * =========================================================
 *
 * Examples:
 *
 * 514604
 * abc
 * 12345
 *
 * return null.
 */
function normalizeSmsPhoneNumber(phone) {
  if (phone === null || phone === undefined) {
    return null;
  }

  const rawPhone = String(phone).trim();

  if (!rawPhone) {
    return null;
  }

  /**
   * Keep digits only for validation
   * and final formatting.
   */
  const digits = rawPhone.replace(/\D/g, "");

  /**
   * =====================================
   * STANDARD CANADA / US
   * =====================================
   *
   * 5146043712
   *
   * becomes:
   *
   * +15146043712
   */
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  /**
   * =====================================
   * CANADA / US WITH COUNTRY CODE
   * =====================================
   *
   * 15146043712
   *
   * becomes:
   *
   * +15146043712
   */
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  /**
   * =====================================
   * INTERNATIONAL E.164
   * =====================================
   *
   * We only automatically accept
   * international numbers when the
   * technician explicitly entered "+".
   *
   * This avoids incorrectly assuming
   * a country code.
   *
   * E.164 supports a maximum of
   * 15 digits.
   */
  if (rawPhone.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  /**
   * Could not safely normalize.
   */
  return null;
}

module.exports = {
  sendVehicleReadyNotification,
  sendVehicleReadyBatch,
  handleTwilioMessageStatus,
};
