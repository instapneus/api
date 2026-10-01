const crypto = require("crypto");

const supabase = require("../../config/supabase");
const AppError = require("../../errors/app-error");

/**
 * =========================================================
 * GOOGLE SHEET RESERVATION
 * =========================================================
 *
 * Supports both:
 *
 * - company
 * - residential
 */

async function getReservationForGoogleSheet(reservationId) {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
          id,
          status,
          reservation_type,
          service_type,

          home_address,
          preferred_date,
          preferred_periods,
          confirmed_date,

          preferred_time_from,
          preferred_time_to,

          customer:customers(
            id,
            first_name,
            last_name,
            email,
            phone
          ),

          availability:company_availabilities(
            id,
            appointment_date,
            technician,
            google_sheet_tab
          )
        `
    )
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch reservation for Google Sheet", {
      status: 500,
      code: "GOOGLE_SHEET_RESERVATION_FETCH_FAILED",
      meta: error,
    });
  }

  if (!data) {
    throw new AppError("Reservation not found", {
      status: 404,
      code: "RESERVATION_NOT_FOUND",
      meta: {
        reservationId,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * CREATE COMPANY RESERVATION
 * =========================================================
 */

async function createCompanyReservation({
  customerId,
  availability,
  companyId,
  locationId,
  serviceCount,
  preferredTimeFrom,
  preferredTimeTo,
}) {
  const { data, error } = await supabase
    .from("reservations")
    .insert({
      customer_id: customerId,
      availability_id: availability.id,
      company_id: companyId || null,
      location_id: locationId || null,
      preferred_time_from: preferredTimeFrom || null,
      preferred_time_to: preferredTimeTo || null,
      reservation_type: "company",
      service_type: availability.service_type,
      status: "confirmed",
      service_count: serviceCount,
      access_token: crypto.randomUUID(),
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create company reservation", {
      status: 500,
      code: "CREATE_COMPANY_RESERVATION_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * =========================================================
 * CREATE RESIDENTIAL RESERVATION
 * =========================================================
 */

async function createResidentialReservation({
  serviceType,
  customerId,
  address,
  preferredDate,
  preferredPeriods,
  serviceCount,
}) {
  const homeAddress = formatAddress(address);

  const { data, error } = await supabase
    .from("reservations")
    .insert({
      customer_id: customerId,
      service_type: serviceType,
      home_address: homeAddress,
      preferred_date: preferredDate,
      preferred_periods: preferredPeriods,
      confirmed_date: null,
      reservation_type: "residential",
      status: "pending",
      service_count: serviceCount,
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create residential reservation", {
      status: 500,
      code: "CREATE_RESIDENTIAL_RESERVATION_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * =========================================================
 * RESERVATION CONFIRMATION
 * =========================================================
 */

async function getReservationConfirmation({
  reservationId,
  reservationType,
  serviceType,
}) {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
          id,
          status,
          reservation_type,
          service_type,
          service_count,

          home_address,
          preferred_date,
          preferred_periods,
          confirmed_date,

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
            is_oil_change_active,
            address,
            city,
            province,
            postal_code
          ),

          availability:company_availabilities(
            id,
            appointment_date,
            available_from,
            available_to,
            service_location_info
          )
        `
    )
    .eq("id", reservationId)
    .eq("reservation_type", reservationType)
    .eq("service_type", serviceType)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch reservation", {
      status: 500,
      code: "FETCH_RESERVATION_FAILED",
      meta: error,
    });
  }

  if (!data) {
    throw new AppError("Reservation not found", {
      status: 404,
      code: "RESERVATION_NOT_FOUND",
      meta: {
        reservationId,
        reservationType,
        serviceType,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * GET RESERVATION
 * =========================================================
 */

async function getReservationById(reservationId) {
  const { data, error } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch reservation", {
      status: 500,
      code: "FETCH_RESERVATION_FAILED",
      meta: error,
    });
  }

  if (!data) {
    throw new AppError("Reservation not found", {
      status: 404,
      code: "RESERVATION_NOT_FOUND",
      meta: {
        reservationId,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * ACTIVE RESERVATIONS
 * =========================================================
 */

async function getActiveReservations(customerId) {
  const { data, error } = await supabase
    .from("reservations")
    .select(
      `
          id,
          status,
          access_token,
          availability_id,
          service_type,
          reservation_type,

          home_address,
          preferred_date,
          confirmed_date,

          company:companies(
            id,
            name,
            code
          ),

          location:company_locations(
            id,
            name
          ),

          availability:company_availabilities(
            id,
            appointment_date
          )
        `
    )
    .eq("customer_id", customerId)
    .neq("status", "cancelled")
    .order("created_at", {
      ascending: false,
    });

  if (error) {
    throw new AppError("Failed to fetch active reservations", {
      status: 500,
      code: "ACTIVE_RESERVATIONS_FETCH_FAILED",
      meta: error,
    });
  }

  return data || [];
}

/**
 * =========================================================
 * HAS RESERVATION ACCESS
 * =========================================================
 */

async function hasReservationAccess(reservationId, token) {
  if (!token) {
    return false;
  }

  const { data, error } = await supabase
    .from("reservations")
    .select("access_token")
    .eq("id", reservationId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  return data.access_token === token;
}

/**
 * =========================================================
 * VALIDATE RESERVATION ACCESS
 * =========================================================
 */

async function validateReservationAccess(reservationId, token) {
  const reservation = await getReservationById(reservationId);

  if (!token || reservation.access_token !== token) {
    throw new AppError("Invalid reservation token", {
      status: 401,
      code: "INVALID_RESERVATION_TOKEN",
      meta: {
        reservationId,
      },
    });
  }

  return reservation;
}

/**
 * =========================================================
 * UPDATE RESIDENTIAL WORKFLOW
 * =========================================================
 *
 * Used by customer service from Google Sheets.
 *
 * Supports partial updates:
 *
 * status only
 * confirmedDate only
 * or both.
 */

async function updateResidentialWorkflow({
  reservationId,
  status,
  confirmedDate,
}) {
  const updates = {};

  /**
   * Only update status if it was actually supplied.
   */
  if (status !== undefined) {
    updates.status = status;
  }

  /**
   * confirmedDate can intentionally be null,
   * allowing customer service to clear the date.
   */
  if (confirmedDate !== undefined) {
    updates.confirmed_date = confirmedDate || null;
  }

  if (Object.keys(updates).length === 0) {
    throw new AppError("No residential workflow fields provided", {
      status: 400,
      code: "NO_RESIDENTIAL_WORKFLOW_FIELDS",
      meta: {
        reservationId,
      },
    });
  }

  const { data, error } = await supabase
    .from("reservations")
    .update(updates)
    .eq("id", reservationId)
    .eq("reservation_type", "residential")
    .select()
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to update residential workflow", {
      status: 500,
      code: "UPDATE_RESIDENTIAL_WORKFLOW_FAILED",
      meta: {
        reservationId,
        updates,
        error,
      },
    });
  }

  if (!data) {
    throw new AppError("Residential reservation not found", {
      status: 404,
      code: "RESIDENTIAL_RESERVATION_NOT_FOUND",
      meta: {
        reservationId,
      },
    });
  }

  return data;
}

/**
 * =========================================================
 * CANCEL RESERVATION
 * =========================================================
 */

async function cancelReservation(reservationId) {
  const { data, error } = await supabase
    .from("reservations")
    .update({
      status: "cancelled",

      cancelled_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to cancel reservation", {
      status: 500,
      code: "CANCEL_RESERVATION_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * =========================================================
 * UPDATE COMPANY AVAILABILITY
 * =========================================================
 */

async function updateReservationAvailability(reservationId, availabilityId) {
  const { data, error } = await supabase
    .from("reservations")
    .update({
      availability_id: availabilityId,
    })
    .eq("id", reservationId)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to update reservation availability", {
      status: 500,
      code: "UPDATE_AVAILABILITY_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * =========================================================
 * RECALCULATE SERVICE COUNT
 * =========================================================
 */

async function recalculateServiceCount(reservationId) {
  const {
    data: vehicles,

    error,
  } = await supabase
    .from("reservation_vehicles")
    .select(
      `
          id,

          selected_services:reservation_vehicle_services(
            id
          )
        `
    )
    .eq("reservation_id", reservationId);

  if (error) {
    throw new AppError("Failed to calculate reservation service count", {
      status: 500,
      code: "SERVICE_COUNT_RECALCULATE_FAILED",
      meta: error,
    });
  }

  const serviceCount = (vehicles || []).reduce(
    (total, vehicle) => total + (vehicle.selected_services?.length || 0),
    0
  );

  const {
    data,

    error: updateError,
  } = await supabase
    .from("reservations")
    .update({
      service_count: serviceCount,
    })
    .eq("id", reservationId)
    .select()
    .single();

  if (updateError) {
    throw new AppError("Failed to update reservation service count", {
      status: 500,
      code: "SERVICE_COUNT_UPDATE_FAILED",
      meta: updateError,
    });
  }

  return data;
}

/**
 * =========================================================
 * ADDRESS FORMATTER
 * =========================================================
 */

function formatAddress(address) {
  if (!address) {
    return null;
  }

  if (typeof address === "string") {
    return address;
  }

  return [address.civicNumber, address.street, address.city, address.postalCode]
    .filter(Boolean)
    .join(" ");
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  getReservationForGoogleSheet,
  createCompanyReservation,
  createResidentialReservation,
  getReservationConfirmation,
  getReservationById,
  getActiveReservations,
  hasReservationAccess,
  validateReservationAccess,
  updateResidentialWorkflow,
  cancelReservation,
  updateReservationAvailability,
  recalculateServiceCount,
};
