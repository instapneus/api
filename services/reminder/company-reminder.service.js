const reminderRepository = require("./reminder.repository");
const notificationService = require("../notification.service");

const TIME_ZONE = "America/Montreal";

const MAX_REMINDER_ATTEMPTS = 3;
const PROCESSING_STALE_MINUTES = 30;

const REMINDER_CONFIG = {
  "72h": {
    daysBeforeAppointment: 3,
  },

  "24h": {
    daysBeforeAppointment: 1,
  },
};

/**
 * =========================================================
 * PROCESS ALL COMPANY REMINDERS
 * =========================================================
 *
 * Called by the protected cron endpoint.
 *
 * Checks:
 *
 * 72h → appointments 3 Montreal calendar days from now
 * 24h → appointments 1 Montreal calendar day from now
 */
async function processCompanyReminders({ now = new Date() } = {}) {
  const results = [];

  for (const [reminderType, config] of Object.entries(REMINDER_CONFIG)) {
    const appointmentDate = getMontrealDateKey(
      now,
      config.daysBeforeAppointment
    );

    const reservations =
      await reminderRepository.getCompanyReservationsForAppointmentDate(
        appointmentDate
      );

    for (const reservation of reservations) {
      const result = await processReservationReminder({
        reservation,
        reminderType,
      });

      results.push(result);
    }
  }

  return buildReminderSummary(results);
}

/**
 * =========================================================
 * PROCESS ONE RESERVATION REMINDER
 * =========================================================
 *
 * Each reminder has two independent channels:
 *
 * - email
 * - sms
 *
 * This means one channel can fail without blocking the other.
 */
async function processReservationReminder({ reservation, reminderType }) {
  const appointmentDate = reservation.availability?.appointment_date;

  const email = await processReminderChannel({
    reservation,
    reminderType,
    channel: "email",
    appointmentDate,
  });

  const sms = await processReminderChannel({
    reservation,
    reminderType,
    channel: "sms",
    appointmentDate,
  });

  return {
    reservationId: reservation.id,
    appointmentDate,
    reminderType,
    email,
    sms,
  };
}

/**
 * =========================================================
 * PROCESS ONE REMINDER CHANNEL
 * =========================================================
 *
 * Handles:
 *
 * - tracking record creation
 * - duplicate protection
 * - processing lock
 * - stale processing recovery
 * - retry limit
 * - notification sending
 * - sent / failed state
 */
async function processReminderChannel({
  reservation,
  reminderType,
  channel,
  appointmentDate,
}) {
  const reminder = await reminderRepository.getOrCreateReminder({
    reservationId: reservation.id,
    appointmentDate,
    reminderType,
    channel,
  });

  /**
   * Already successfully sent.
   *
   * Never send again.
   */
  if (reminder.status === "sent") {
    return {
      sent: false,
      skipped: true,
      reason: "ALREADY_SENT",
      reminderId: reminder.id,
    };
  }

  /**
   * Reminder is currently being processed.
   *
   * If it is recent, another worker may still
   * legitimately be sending it.
   */
  if (
    reminder.status === "processing" &&
    !isProcessingReminderStale(reminder)
  ) {
    return {
      sent: false,
      skipped: true,
      reason: "ALREADY_PROCESSING",
      reminderId: reminder.id,
    };
  }

  /**
   * Stop retrying after too many attempts.
   */
  if (reminder.attempt_count >= MAX_REMINDER_ATTEMPTS) {
    return {
      sent: false,
      skipped: true,
      reason: "MAX_ATTEMPTS_REACHED",
      reminderId: reminder.id,
    };
  }

  /**
   * =======================================================
   * CLAIM REMINDER
   * =======================================================
   *
   * Normal:
   *
   * pending / failed
   *      ↓
   * processing
   *
   *
   * Recovery:
   *
   * stale processing
   *      ↓
   * processing again
   */
  let claimedReminder;

  if (reminder.status === "processing") {
    claimedReminder = await reminderRepository.reclaimStaleReminder({
      reminderId: reminder.id,
      currentAttemptCount: reminder.attempt_count,
      lastAttemptAt: reminder.last_attempt_at,
    });
  } else {
    claimedReminder = await reminderRepository.claimReminder({
      reminderId: reminder.id,
      currentAttemptCount: reminder.attempt_count,
    });
  }

  /**
   * Another worker claimed or modified the
   * reminder before us.
   */
  if (!claimedReminder) {
    return {
      sent: false,
      skipped: true,
      reason: "CLAIM_LOST",
      reminderId: reminder.id,
    };
  }

  try {
    const customer = reservation.customer;

    /**
     * =====================================================
     * EMAIL
     * =====================================================
     */
    if (channel === "email") {
      if (!customer?.email) {
        throw new Error("Customer email is missing");
      }

      const result =
        await notificationService.sendCompanyAppointmentReminderEmail({
          reminderType,
          reservation,
        });

      if (!result?.sent) {
        throw createNotificationError(result, "Company reminder email failed");
      }

      await reminderRepository.markReminderSent({
        reminderId: claimedReminder.id,
        providerMessageId: result.messageId || null,
      });

      return {
        sent: true,
        skipped: false,
        channel,
        reminderId: claimedReminder.id,
        providerMessageId: result.messageId || null,
      };
    }

    /**
     * =====================================================
     * SMS
     * =====================================================
     */
    if (channel === "sms") {
      if (!customer?.phone) {
        throw new Error("Customer phone is missing");
      }

      const result =
        await notificationService.sendCompanyAppointmentReminderSms({
          reminderType,
          reservation,
        });

      if (!result?.sent) {
        throw createNotificationError(result, "Company reminder SMS failed");
      }

      await reminderRepository.markReminderSent({
        reminderId: claimedReminder.id,
        providerMessageId: result.messageId || null,
      });

      return {
        sent: true,
        skipped: false,
        channel,
        reminderId: claimedReminder.id,
        providerMessageId: result.messageId || null,
      };
    }

    /**
     * Should never happen because we currently
     * only support email and sms.
     */
    throw new Error(`Unsupported reminder channel: ${channel}`);
  } catch (error) {
    const errorMessage = error?.message || "Unknown reminder error";

    await reminderRepository.markReminderFailed({
      reminderId: claimedReminder.id,
      errorMessage,
    });

    return {
      sent: false,
      skipped: false,
      failed: true,
      channel,
      reminderId: claimedReminder.id,
      error: errorMessage,
    };
  }
}

/**
 * =========================================================
 * CHECK IF PROCESSING REMINDER IS STALE
 * =========================================================
 *
 * Example:
 *
 * Node changes:
 *
 * pending → processing
 *
 * Then Node crashes before sending/finishing.
 *
 * Without this check that reminder would remain
 * "processing" forever.
 *
 * After 30 minutes we allow another worker to reclaim it.
 */
function isProcessingReminderStale(reminder, now = new Date()) {
  if (reminder.status !== "processing" || !reminder.last_attempt_at) {
    return false;
  }

  const lastAttemptAt = new Date(reminder.last_attempt_at);

  if (Number.isNaN(lastAttemptAt.getTime())) {
    return false;
  }

  const staleAfterMs = PROCESSING_STALE_MINUTES * 60 * 1000;

  return now.getTime() - lastAttemptAt.getTime() >= staleAfterMs;
}

/**
 * =========================================================
 * MONTREAL CALENDAR DATE
 * =========================================================
 *
 * company_availabilities.appointment_date
 * is a DATE, not a timestamp.
 *
 * We therefore work with Montreal calendar days.
 *
 * Example:
 *
 * August 19 + 3 days
 * → August 22
 *
 * Not:
 *
 * current timestamp + exactly 72 hours
 */
function getMontrealDateKey(date, daysToAdd = 0) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value);

  const month = Number(parts.find((part) => part.type === "month")?.value);

  const day = Number(parts.find((part) => part.type === "day")?.value);

  const calendarDate = new Date(Date.UTC(year, month - 1, day + daysToAdd));

  return [
    calendarDate.getUTCFullYear(),
    String(calendarDate.getUTCMonth() + 1).padStart(2, "0"),
    String(calendarDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * =========================================================
 * NOTIFICATION ERROR
 * =========================================================
 *
 * Converts the safe notification service response
 * into a normal Error.
 */
function createNotificationError(result, fallbackMessage) {
  const message =
    result?.error?.message || result?.error?.code || fallbackMessage;

  const error = new Error(message);

  if (result?.error?.code) {
    error.code = result.error.code;
  }

  return error;
}

/**
 * =========================================================
 * BUILD API SUMMARY
 * =========================================================
 *
 * Produces the JSON returned by:
 *
 * POST
 * /api/notifications/company-reminders/run
 */
function buildReminderSummary(results) {
  let emailSent = 0;
  let smsSent = 0;
  let failed = 0;
  let skipped = 0;

  for (const result of results) {
    const channels = [result.email, result.sms];

    for (const channelResult of channels) {
      if (!channelResult) {
        continue;
      }

      if (channelResult.sent) {
        if (channelResult.channel === "email") {
          emailSent += 1;
        }

        if (channelResult.channel === "sms") {
          smsSent += 1;
        }
      }

      if (channelResult.failed) {
        failed += 1;
      }

      if (channelResult.skipped) {
        skipped += 1;
      }
    }
  }

  return {
    success: true,
    reservationsProcessed: results.length,
    emailSent,
    smsSent,
    failed,
    skipped,
    results,
  };
}

module.exports = {
  processCompanyReminders,
  processReservationReminder,
  getMontrealDateKey,
};
