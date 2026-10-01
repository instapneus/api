const notificationRepository = require("./../reservation-notification/reservation-notification.repository");
const { sendVehicleReadySms } = require("../notification.service");

/**
 * =========================================================
 * SEND TECHNICIAN SMS
 * =========================================================
 *
 * This service handles ALL SMS messages sent manually
 * by a technician from the Google Sheet.
 *
 *
 * FIRST CONTACT
 * ---------------------------------------------------------
 *
 * initialContact = true
 *
 * Example:
 *
 * Statut du travail = Terminé
 * Avis SMS = 📱 Envoyer SMS
 *
 * This creates:
 *
 * type = vehicle_ready
 * template_code = vehicle_ready
 *
 * Duplicate protection applies.
 *
 *
 * FOLLOW-UP
 * ---------------------------------------------------------
 *
 * initialContact = false
 *
 * Example:
 *
 * Statut du travail = Client contacté
 * Avis SMS = ✅ SMS envoyé · Nouveau SMS
 *
 * This creates:
 *
 * type = follow_up
 * template_code = custom
 *
 * Multiple follow-up SMS messages are allowed.
 */

/**
 * =========================================================
 * SEND TECHNICIAN SMS
 * =========================================================
 */

async function sendTechnicianSms({
  reservationId,
  reservationVehicleId,
  phone,
  vehicleLabel,
  message,
  initialContact = false,
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

  const cleanMessage = String(message || "").trim();

  if (!cleanMessage) {
    throw new Error("message is required");
  }

  /**
   * =====================================
   * NORMALIZE PHONE
   * =====================================
   */

  const normalizedPhone = normalizeSmsPhoneNumber(phone);

  /**
   * =====================================
   * DUPLICATE PROTECTION
   * =====================================
   *
   * ONLY applies to the first
   * "vehicle ready" contact.
   *
   * Follow-up/custom messages are allowed
   * to be sent multiple times.
   */

  if (initialContact) {
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
  }

  /**
   * =====================================
   * NOTIFICATION TYPE
   * =====================================
   */

  const notificationType = initialContact ? "vehicle_ready" : "follow_up";
  const templateCode = initialContact ? "vehicle_ready" : "custom";

  /**
   * =====================================
   * CREATE DATABASE ATTEMPT
   * =====================================
   *
   * We always save the notification BEFORE
   * sending through Twilio.
   *
   * This gives us a complete history,
   * including failed messages.
   */

  let notification;

  try {
    notification = await notificationRepository.createNotificationAttempt({
      reservationId,
      reservationVehicleId,
      type: notificationType,
      templateCode,
      vehicleLabel,
      technician,
      spreadsheetId,
      sheetTab,
      recipientPhone: normalizedPhone || String(phone).trim(),
      message: cleanMessage,
    });
  } catch (error) {
    /**
     * =====================================
     * DUPLICATE RACE CONDITION
     * =====================================
     *
     * PostgreSQL:
     *
     * 23505 = unique violation
     *
     * If two first-contact requests arrive
     * almost simultaneously, the database
     * unique index protects us.
     */

    if (initialContact && error && error.code === "23505") {
      const existingNotification =
        await notificationRepository.findActiveVehicleReadyNotification(
          reservationVehicleId
        );

      return {
        sent: false,
        skipped: true,
        reason: "VEHICLE_ALREADY_NOTIFIED",
        notification: existingNotification,
      };
    }

    throw error;
  }

  /**
   * =====================================
   * INVALID PHONE
   * =====================================
   *
   * We keep the failed notification
   * in Supabase.
   *
   * The technician can then correct
   * the phone number in Google Sheets
   * and retry.
   */

  if (!normalizedPhone) {
    const failedNotification =
      await notificationRepository.markNotificationFailed({
        notificationId: notification.id,
        providerStatus: "invalid_phone",
        providerErrorCode: "INVALID_PHONE_NUMBER",
        providerErrorMessage: `Invalid phone number: ${phone}`,
      });

    return {
      sent: false,
      skipped: false,
      reason: "INVALID_PHONE_NUMBER",
      notification: failedNotification,
      sms: {
        sent: false,
        messageId: null,
        providerStatus: null,
        error: {
          code: "INVALID_PHONE_NUMBER",
          message: "Invalid phone number",
        },
      },
    };
  }

  /**
   * =====================================
   * SEND THROUGH TWILIO
   * =====================================
   *
   * We reuse the existing SMS sender.
   *
   * The BODY is explicitly supplied,
   * so the technician's custom message
   * is sent exactly as written.
   */

  const smsResult = await sendVehicleReadySms({
    phone: normalizedPhone,
    vehicleLabel,
    body: cleanMessage,
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
        providerErrorCode:
          smsResult.error && smsResult.error.providerCode
            ? smsResult.error.providerCode
            : null,
        providerErrorMessage:
          smsResult.error && smsResult.error.message
            ? smsResult.error.message
            : "SMS could not be sent",
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
   * accepted != delivered
   *
   * Twilio will later call our existing
   * status callback and Supabase can become:
   *
   * delivered
   *
   * or:
   *
   * failed
   */

  const acceptedNotification =
    await notificationRepository.markNotificationAccepted({
      notificationId: notification.id,
      providerMessageSid: smsResult.messageId,
      providerStatus: smsResult.providerStatus,
    });

  /**
   * =====================================
   * SUCCESS
   * =====================================
   */

  return {
    sent: true,
    skipped: false,
    notification: acceptedNotification,
    sms: smsResult,
  };
}

/**
 * =========================================================
 * NORMALIZE SMS PHONE NUMBER
 * =========================================================
 *
 * Examples:
 *
 * 5146043712
 * 514-604-3712
 * (514) 604-3712
 *
 * become:
 *
 * +15146043712
 */

function normalizeSmsPhoneNumber(phone) {
  if (phone === null || phone === undefined) {
    return null;
  }

  const rawPhone = String(phone).trim();

  if (!rawPhone) {
    return null;
  }

  const digits = rawPhone.replace(/\D/g, "");

  /**
   * Canada / US
   *
   * 5146043712
   */
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  /**
   * Already includes North American
   * country code.
   *
   * 15146043712
   */
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  /**
   * Other international E.164 number.
   *
   * Only automatically accept it
   * if the technician entered +.
   */
  if (rawPhone.startsWith("+") && digits.length >= 8 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null;
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  sendTechnicianSms,
};
