const supabase = require("./../../config/supabase");

/**
 * =========================================================
 * FIND ACTIVE VEHICLE READY NOTIFICATION
 * =========================================================
 *
 * Returns an existing successful/in-progress
 * vehicle-ready notification.
 *
 * This is what prevents us from sending
 * the normal "vehicle ready" SMS twice.
 */
async function findActiveVehicleReadyNotification(reservationVehicleId) {
  const { data, error } = await supabase
    .from("reservation_notifications")
    .select("*")
    .eq("reservation_vehicle_id", reservationVehicleId)
    .eq("type", "vehicle_ready")
    .in("status", ["pending", "accepted", "delivered"])
    .order("created_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * =========================================================
 * CREATE NOTIFICATION ATTEMPT
 * =========================================================
 *
 * Creates the database record BEFORE
 * calling Twilio.
 *
 * status = pending
 *
 * This also gives us protection against
 * two requests trying to send the same
 * vehicle at exactly the same time.
 */
async function createNotificationAttempt({
  reservationId,
  reservationVehicleId,
  type,
  templateCode,
  vehicleLabel,
  technician,
  spreadsheetId,
  sheetTab,
  recipientPhone,
  message,
}) {
  const { data, error } = await supabase
    .from("reservation_notifications")
    .insert({
      reservation_id: reservationId,

      reservation_vehicle_id: reservationVehicleId,

      type,

      template_code: templateCode,

      vehicle_label: vehicleLabel || null,

      technician: technician || null,

      spreadsheet_id: spreadsheetId || null,

      sheet_tab: sheetTab || null,

      recipient_phone: recipientPhone,

      message,

      status: "pending",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * =========================================================
 * MARK ACCEPTED
 * =========================================================
 *
 * Twilio accepted the outbound message.
 *
 * IMPORTANT:
 *
 * This does NOT mean the customer's
 * phone received it yet.
 */
async function markNotificationAccepted({
  notificationId,
  providerMessageSid,
  providerStatus,
}) {
  const { data, error } = await supabase
    .from("reservation_notifications")
    .update({
      status: "accepted",

      provider_message_sid: providerMessageSid,

      provider_status: providerStatus || null,

      sent_at: new Date().toISOString(),

      updated_at: new Date().toISOString(),
    })
    .eq("id", notificationId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * =========================================================
 * MARK FAILED
 * =========================================================
 *
 * Used when Twilio fails immediately
 * while attempting to create/send
 * the outbound message.
 */
async function markNotificationFailed({
  notificationId,
  providerStatus = null,
  providerErrorCode = null,
  providerErrorMessage = null,
}) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("reservation_notifications")
    .update({
      status: "failed",

      provider_status: providerStatus,

      provider_error_code: providerErrorCode ? String(providerErrorCode) : null,

      provider_error_message: providerErrorMessage,

      failed_at: now,

      updated_at: now,
    })
    .eq("id", notificationId)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * =========================================================
 * FIND BY TWILIO MESSAGE SID
 * =========================================================
 *
 * Later Twilio's status callback
 * will identify the SMS using its SID.
 */
async function getNotificationByProviderMessageSid(providerMessageSid) {
  const { data, error } = await supabase
    .from("reservation_notifications")
    .select("*")
    .eq("provider_message_sid", providerMessageSid)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * =========================================================
 * UPDATE PROVIDER STATUS
 * =========================================================
 *
 * We'll use this later for Twilio callbacks.
 *
 * Examples:
 *
 * queued
 * sent
 * delivered
 * failed
 * undelivered
 */
async function updateProviderStatus({
  providerMessageSid,
  providerStatus,
  status,
  providerErrorCode = null,
  providerErrorMessage = null,
}) {
  const now = new Date().toISOString();

  const updates = {
    provider_status: providerStatus || null,

    status,

    updated_at: now,
  };

  /**
   * Delivered.
   */
  if (status === "delivered") {
    updates.delivered_at = now;
  }

  /**
   * Failed / undelivered.
   */
  if (status === "failed") {
    updates.failed_at = now;

    updates.provider_error_code = providerErrorCode
      ? String(providerErrorCode)
      : null;

    updates.provider_error_message = providerErrorMessage;
  }

  const { data, error } = await supabase
    .from("reservation_notifications")
    .update(updates)
    .eq("provider_message_sid", providerMessageSid)
    .select()
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

/**
 * =========================================================
 * NOTIFICATION HISTORY FOR VEHICLE
 * =========================================================
 *
 * Useful later for:
 *
 * - retries
 * - follow-ups
 * - admin history
 */
async function getVehicleNotificationHistory(reservationVehicleId) {
  const { data, error } = await supabase
    .from("reservation_notifications")
    .select("*")
    .eq("reservation_vehicle_id", reservationVehicleId)
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw error;
  }

  return data || [];
}

module.exports = {
  findActiveVehicleReadyNotification,
  createNotificationAttempt,
  markNotificationAccepted,
  markNotificationFailed,
  getNotificationByProviderMessageSid,
  updateProviderStatus,
  getVehicleNotificationHistory,
};
