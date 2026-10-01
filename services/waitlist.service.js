// services/waitlist.service.js
const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

const customerService = require("./customer.service");
const notificationService = require("./notification.service");
const availabilityService = require("./availability.service");
const logger = require("./logger/logger.service");

async function joinAvailabilityWaitlist({ availabilityId, user }) {
  if (!user?.email) {
    throw new AppError("Email is required", {
      status: 400,
      code: "WAITLIST_EMAIL_REQUIRED",
    });
  }

  const email = user.email.trim().toLowerCase();

  const customer = await customerService.getCustomerByEmail(email);

  const { data: existing, error: existingError } = await supabase
    .from("availability_waitlist")
    .select("*")
    .eq("availability_id", availabilityId)
    .eq("email", email)
    .in("status", ["waiting", "notified"])
    .maybeSingle();

  if (existingError) {
    throw new AppError("Failed to check waitlist", {
      status: 500,
      code: "WAITLIST_FETCH_FAILED",
      meta: existingError,
    });
  }

  if (existing) {
    return existing;
  }

  const { data, error } = await supabase
    .from("availability_waitlist")
    .insert({
      availability_id: availabilityId,
      customer_id: customer?.id || null,
      first_name: user.firstName || null,
      last_name: user.lastName || null,
      email,
      phone: user.phone || null,
      status: "waiting",
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to join waitlist", {
      status: 500,
      code: "WAITLIST_JOIN_FAILED",
      meta: error,
    });
  }

  return data;
}

async function getActiveWaitlistEntries(email) {
  const { data, error } = await supabase
    .from("availability_waitlist")
    .select("availability_id, status, notified_at, expires_at")
    .eq("email", email.toLowerCase())
    .in("status", ["waiting", "notified"]);

  if (error) {
    throw new AppError("Failed to fetch waitlist entries", {
      status: 500,
      code: "WAITLIST_FETCH_FAILED",
      meta: error,
    });
  }

  return data || [];
}

async function notifyWaitlistForAvailability(availabilityId) {
  try {
    const capacity = await availabilityService.getAvailabilityCapacity(
      availabilityId
    );

    if (!capacity.hasSpace) {
      return {
        success: true,
        notified: 0,
        failed: 0,
        reason: "NO_SPACE",
        results: [],
      };
    }

    const { data: entries, error } = await supabase
      .from("availability_waitlist")
      .select("*")
      .eq("availability_id", availabilityId)
      .eq("status", "waiting")
      .not("phone", "is", null)
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) {
      logger.error("Failed to fetch waitlist entries for notification", {
        event: "WAITLIST_NOTIFICATION_FETCH_FAILED",
        category: "database",
        error,
        context: {
          availabilityId,
        },
      });

      return {
        success: false,
        notified: 0,
        failed: 0,
        reason: "WAITLIST_FETCH_FAILED",
        results: [],
      };
    }

    if (!entries?.length) {
      return {
        success: true,
        notified: 0,
        failed: 0,
        reason: "NO_WAITING_ENTRIES",
        results: [],
      };
    }

    const results = [];

    for (const entry of entries) {
      const attemptedAt = new Date().toISOString();

      const notificationResult =
        await notificationService.sendWaitlistAvailabilitySms({
          waitlistEntry: entry,
          availability: capacity.availability,
        });

      if (notificationResult.sent) {
        const { error: updateError } = await supabase
          .from("availability_waitlist")
          .update({
            status: "notified",
            notified_at: attemptedAt,
            expires_at: new Date(
              Date.now() + 24 * 60 * 60 * 1000
            ).toISOString(),
            last_notification_attempt_at: attemptedAt,
            last_notification_failed_at: null,
            last_notification_error: null,
          })
          .eq("id", entry.id);

        if (updateError) {
          logger.error("Waitlist SMS was sent, but the entry update failed", {
            event: "WAITLIST_NOTIFICATION_SUCCESS_UPDATE_FAILED",
            category: "database",
            error: updateError,
            context: {
              availabilityId,
              waitlistEntryId: entry.id,
              messageId: notificationResult.messageId,
            },
          });

          results.push({
            waitlistEntryId: entry.id,
            sent: true,
            updated: false,
            error: updateError,
          });

          continue;
        }

        results.push({
          waitlistEntryId: entry.id,
          sent: true,
          updated: true,
          messageId: notificationResult.messageId,
        });

        continue;
      }

      const failureCount = (entry.notification_failure_count ?? 0) + 1;

      const failureMessage =
        notificationResult.error?.message ??
        notificationResult.reason ??
        "Unknown notification error";

      const { error: failureUpdateError } = await supabase
        .from("availability_waitlist")
        .update({
          last_notification_attempt_at: attemptedAt,
          last_notification_failed_at: attemptedAt,
          notification_failure_count: failureCount,
          last_notification_error: failureMessage,
        })
        .eq("id", entry.id);

      if (failureUpdateError) {
        logger.error("Failed to save waitlist notification failure", {
          event: "WAITLIST_NOTIFICATION_FAILURE_UPDATE_FAILED",
          category: "database",
          error: failureUpdateError,
          context: {
            availabilityId,
            waitlistEntryId: entry.id,
            notificationFailureCount: failureCount,
          },
        });
      }

      results.push({
        waitlistEntryId: entry.id,
        sent: false,
        updated: !failureUpdateError,
        failureCount,
        error: notificationResult.error,
        reason: notificationResult.reason,
      });
    }

    const notified = results.filter((result) => result.sent).length;

    const failed = results.filter((result) => !result.sent).length;

    return {
      success: failed === 0,
      notified,
      failed,
      results,
    };
  } catch (error) {
    logger.error("Unexpected waitlist notification process failure", {
      event: "WAITLIST_NOTIFICATION_PROCESS_FAILED",
      category: "waitlist",
      error,
      context: {
        availabilityId,
      },
    });

    return {
      success: false,
      notified: 0,
      failed: 0,
      reason: "WAITLIST_PROCESS_FAILED",
      results: [],
    };
  }
}

async function markWaitlistEntryBooked({
  availabilityId,
  email,
  reservationId,
}) {
  if (!availabilityId || !email) return null;

  const normalizedEmail = email.trim().toLowerCase();

  const { data, error } = await supabase
    .from("availability_waitlist")
    .update({
      status: "booked",
      reservation_id: reservationId,
      booked_at: new Date().toISOString(),
    })
    .eq("availability_id", availabilityId)
    .eq("email", normalizedEmail)
    .in("status", ["waiting", "notified"])
    .select()
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to update waitlist entry", {
      status: 500,
      code: "WAITLIST_BOOKING_UPDATE_FAILED",
      meta: error,
    });
  }

  return data;
}

async function getWaitlistCountForAvailability(availabilityId) {
  const { count, error } = await supabase
    .from("availability_waitlist")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("availability_id", availabilityId)
    .in("status", ["waiting", "notified"]);

  if (error) {
    throw new AppError("Failed to count availability waitlist", {
      status: 500,
      code: "WAITLIST_COUNT_FETCH_FAILED",
      meta: error,
    });
  }

  return count || 0;
}

async function getWaitlistForAvailability(availabilityId) {
  const { data, error } = await supabase
    .from("availability_waitlist")
    .select("*")
    .eq("availability_id", availabilityId)
    .in("status", ["waiting", "notified"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new AppError("Failed to fetch availability waitlist", {
      status: 500,
      code: "WAITLIST_FETCH_FAILED",
      meta: error,
    });
  }

  return (data || []).map((entry) => ({
    id: entry.id,
    availability_id: entry.availability_id,
    customer_id: entry.customer_id,

    first_name: entry.first_name,
    last_name: entry.last_name,
    email: entry.email,
    phone: entry.phone,

    status: entry.status,

    notified_at: entry.notified_at,
    expires_at: entry.expires_at,
    booked_at: entry.booked_at,

    reservation_id: entry.reservation_id,

    created_at: entry.created_at,

    last_notification_failed_at:
      entry.last_notification_failed_at,

    last_notification_attempt_at:
      entry.last_notification_attempt_at,

    notification_failure_count:
      entry.notification_failure_count,

    last_notification_error:
      entry.last_notification_error,
  }));
}

async function updateWaitlistStatus(
  waitlistId,
  status
) {
  const allowedStatuses = [
    "waiting",
    "notified",
  ];

  if (!allowedStatuses.includes(status)) {
    throw new AppError("Invalid waitlist status", {
      status: 400,
      code: "INVALID_WAITLIST_STATUS",
    });
  }

  const updates = {
    status,
  };

  if (status === "notified") {
    updates.notified_at = new Date().toISOString();
  }

  if (status === "waiting") {
    updates.notified_at = null;
    updates.expires_at = null;
  }

  const { data, error } = await supabase
    .from("availability_waitlist")
    .update(updates)
    .eq("id", waitlistId)
    .in("status", ["waiting", "notified"])
    .select(`
      id,
      availability_id,
      customer_id,
      first_name,
      last_name,
      email,
      phone,
      status,
      notified_at,
      expires_at,
      booked_at,
      reservation_id,
      created_at,
      last_notification_failed_at,
      last_notification_attempt_at,
      notification_failure_count,
      last_notification_error
    `)
    .single();

  if (error) {
    throw new AppError(
      "Failed to update waitlist status",
      {
        status: 500,
        code: "WAITLIST_STATUS_UPDATE_FAILED",
        meta: error,
      }
    );
  }

  return data;
}

module.exports = {
  joinAvailabilityWaitlist,
  notifyWaitlistForAvailability,
  getActiveWaitlistEntries,
  markWaitlistEntryBooked,
  getWaitlistCountForAvailability,
  getWaitlistForAvailability,
  updateWaitlistStatus,
};
