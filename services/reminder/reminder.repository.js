const supabase = require("../../config/supabase");
const AppError = require("../../errors/app-error");

/**
 * =========================================================
 * COMPANY RESERVATIONS FOR REMINDER DATE
 * =========================================================
 *
 * Returns confirmed company reservations whose
 * company availability is scheduled on appointmentDate.
 *
 * appointmentDate format:
 * YYYY-MM-DD
 */

async function getCompanyReservationsForAppointmentDate(appointmentDate) {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
        id,
        status,
        reservation_type,
        service_type,
        access_token,
        preferred_time_from,
        preferred_time_to,

        customer:customers(
          id,
          first_name,
          last_name,
          email,
          phone
        ),

        company:companies(
          id,
          name,
          code
        ),

        location:company_locations(
          id,
          name,
          address,
          city,
          province,
          postal_code
        ),

        availability:company_availabilities!inner(
          id,
          appointment_date,
          available_from,
          available_to,
          service_type
        )
      `
    )
    .eq("reservation_type", "company")
    .eq("status", "confirmed")
    .eq("availability.appointment_date", appointmentDate);

  if (error) {
    throw new AppError("Failed to fetch company reservations for reminders", {
      status: 500,
      code: "COMPANY_REMINDER_RESERVATIONS_FETCH_FAILED",
      meta: {
        appointmentDate,
        error,
      },
    });
  }

  return data || [];
}

/**
 * =========================================================
 * GET REMINDER
 * =========================================================
 */

async function getReminder({
  reservationId,
  appointmentDate,
  reminderType,
  channel,
}) {
  const { data, error } = await supabase
    .from("reservation_reminders")
    .select("*")
    .eq("reservation_id", reservationId)
    .eq("appointment_date", appointmentDate)
    .eq("reminder_type", reminderType)
    .eq("channel", channel)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch reservation reminder", {
      status: 500,
      code: "RESERVATION_REMINDER_FETCH_FAILED",
      meta: {
        reservationId,
        appointmentDate,
        reminderType,
        channel,
        error,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * CREATE REMINDER
 * =========================================================
 */

async function createReminder({
  reservationId,
  appointmentDate,
  reminderType,
  channel,
}) {
  const { data, error } = await supabase
    .from("reservation_reminders")
    .insert({
      reservation_id: reservationId,
      appointment_date: appointmentDate,
      reminder_type: reminderType,
      channel,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    /**
     * PostgreSQL unique violation.
     *
     * This can happen safely if two reminder workers
     * attempt to create the exact same reminder at once.
     */
    if (error.code === "23505") {
      return getReminder({
        reservationId,
        appointmentDate,
        reminderType,
        channel,
      });
    }

    throw new AppError("Failed to create reservation reminder", {
      status: 500,
      code: "RESERVATION_REMINDER_CREATE_FAILED",
      meta: {
        reservationId,
        appointmentDate,
        reminderType,
        channel,
        error,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * GET OR CREATE REMINDER
 * =========================================================
 */

async function getOrCreateReminder({
  reservationId,
  appointmentDate,
  reminderType,
  channel,
}) {
  const existingReminder = await getReminder({
    reservationId,
    appointmentDate,
    reminderType,
    channel,
  });

  if (existingReminder) {
    return existingReminder;
  }

  return createReminder({
    reservationId,
    appointmentDate,
    reminderType,
    channel,
  });
}

/**
 * =========================================================
 * CLAIM REMINDER
 * =========================================================
 *
 * Atomically changes a pending/failed reminder to processing.
 *
 * If another worker already claimed it, this returns null.
 */

async function claimReminder({ reminderId, currentAttemptCount = 0 }) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reservation_reminders")
    .update({
      status: "processing",
      attempt_count: currentAttemptCount + 1,
      last_attempt_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", reminderId)
    .eq("attempt_count", currentAttemptCount)
    .in("status", ["pending", "failed"])
    .select()
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to claim reservation reminder", {
      status: 500,
      code: "RESERVATION_REMINDER_CLAIM_FAILED",
      meta: {
        reminderId,
        error,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * MARK SENT
 * =========================================================
 */

async function markReminderSent({ reminderId, providerMessageId = null }) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reservation_reminders")
    .update({
      status: "sent",
      sent_at: now,
      provider_message_id: providerMessageId,
      error_message: null,
      updated_at: now,
    })
    .eq("id", reminderId)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to mark reservation reminder as sent", {
      status: 500,
      code: "RESERVATION_REMINDER_SENT_UPDATE_FAILED",
      meta: {
        reminderId,
        error,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * MARK FAILED
 * =========================================================
 */

async function markReminderFailed({ reminderId, errorMessage }) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reservation_reminders")
    .update({
      status: "failed",
      error_message: errorMessage || "Unknown reminder error",
      updated_at: now,
    })
    .eq("id", reminderId)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to mark reservation reminder as failed", {
      status: 500,
      code: "RESERVATION_REMINDER_FAILED_UPDATE_FAILED",
      meta: {
        reminderId,
        error,
      },
    });
  }

  return data;
}

async function reclaimStaleReminder({
  reminderId,
  currentAttemptCount,
  lastAttemptAt,
}) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reservation_reminders")
    .update({
      status: "processing",
      attempt_count: currentAttemptCount + 1,
      last_attempt_at: now,
      error_message: null,
      updated_at: now,
    })
    .eq("id", reminderId)
    .eq("status", "processing")
    .eq("attempt_count", currentAttemptCount)
    .eq("last_attempt_at", lastAttemptAt)
    .select()
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to reclaim stale reminder", {
      status: 500,
      code: "REMINDER_STALE_RECLAIM_FAILED",
      meta: {
        reminderId,
        error,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  getCompanyReservationsForAppointmentDate,
  getReminder,
  createReminder,
  getOrCreateReminder,
  claimReminder,
  reclaimStaleReminder,
  markReminderSent,
  markReminderFailed,
};
