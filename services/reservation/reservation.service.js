const AppError = require("../../errors/app-error");

const reservationRepository = require("./reservation.repository");
const reservationMapper = require("./reservation.mapper");
const reservationTireRepository = require("./reservation-tire.repository");
const reservationVehicleService = require("./vehicle/reservation-vehicle.service");

const {
  syncReservationToGoogleSheet,
  removeVehicleFromGoogleSheet,
  syncReservationAvailabilityChange,
} = require("../google-sheet/reservation-sheet-sync.service");

const customerService = require("../customer.service");
const availabilityService = require("../availability.service");
const tirePurchaseRequestService = require("../tire-purchase-request.service");
const serviceInterestService = require("../service-interest.service");
const notificationService = require("../notification.service");
const waitlistService = require("../waitlist.service");
const {
  syncTireEstimateToGoogleSheet,
} = require("../google-sheet/tire-estimate-sheet-sync.service");
const { getConfirmationUrl } = require("../../helpers/reservationUrl");

/**
 * Creates a company reservation and all associated records.
 */
async function createCompanyReservation(payload) {
  const {
    inscription,
    criteria,
    selectedAvailability,
    selectedCompany,
    selectedCompanyLocation,
    vehicleServices,
  } = payload;

  await availabilityService.validateAvailability(selectedAvailability.id);

  const customer = await customerService.upsertCustomer(inscription.user);

  const reservation = await reservationRepository.createCompanyReservation({
    customerId: customer.id,
    availability: selectedAvailability,
    companyId: selectedCompany?.id,
    locationId: selectedCompanyLocation?.id,
    serviceCount: countSelectedServices(vehicleServices),
    preferredTimeFrom: criteria.timeRange?.preferredTimeFrom,
    preferredTimeTo: criteria.timeRange?.preferredTimeTo,
  });

  const createdVehicles = await reservationVehicleService.createVehicles(
    reservation.id,
    vehicleServices
  );

  await tirePurchaseRequestService.createTireRequestFromCompanyReservation(
    customer.id,
    selectedCompany?.id,
    selectedCompanyLocation?.id,
    reservation.id,
    createdVehicles
  );

  await serviceInterestService.createMechanicInterest(
    customer.id,
    selectedCompany?.id,
    selectedCompanyLocation?.id,
    vehicleServices
  );

  await waitlistService.markWaitlistEntryBooked({
    availabilityId: selectedAvailability.id,
    email: customer.email,
    reservationId: reservation.id,
  });

  const notification =
    await notificationService.sendCompanyReservationConfirmation({
      reservation,
      customer,
      company: selectedCompany,
      location: selectedCompanyLocation,
      availability: selectedAvailability,
    });

  /*
   * Synchronize the completed reservation
   * with the technician Google Sheet.
   *
   * We deliberately don't await this call.
   * A Google Sheet failure must not cause
   * the customer's reservation to fail.
   */

  void syncTireEstimateToGoogleSheet({
    reservationId: reservation.id,
  }).catch((error) => {
    console.error("Tire request Google Sheet synchronization failed:", {
      reservationId: reservation.id,
      error,
    });
  });

  void syncReservationToGoogleSheet(reservation.id).catch((error) => {
    console.error("Google Sheet synchronization failed:", {
      reservationId: reservation.id,
      error,
    });
  });

  return {
    reservation,
    customer,
    availability: selectedAvailability,
    company: selectedCompany,
    location: selectedCompanyLocation,
    notification,
  };
}

/**
 * Creates a residential reservation and all associated records.
 */
async function createResidentialReservation(payload) {
  const { serviceType, inscription, time, vehicleServices } = payload;

  /**
   * Create / update customer.
   */
  const customer = await customerService.upsertCustomer(inscription.user);

  /**
   * Create residential reservation.
   */
  const reservation = await reservationRepository.createResidentialReservation({
    serviceType,
    customerId: customer.id,
    address: inscription.address,
    preferredDate: time.date,
    preferredPeriods: time.period,
    serviceCount: countSelectedServices(vehicleServices),
  });

  /**
   * Create reservation vehicles
   * and their selected services.
   */
  const createdVehicles = await reservationVehicleService.createVehicles(
    reservation.id,
    vehicleServices
  );

  /**
   * Tire purchase request.
   */
  const tireRequestResult =
    await tirePurchaseRequestService.createTireRequestFromResidentialReservation(
      customer.id,
      reservation.id,
      inscription.address,
      createdVehicles
    );

  /**
   * Mobile mechanic interest stays in Supabase.
   *
   * It is intentionally NOT displayed
   * as a separate Google Sheet column.
   */
  await serviceInterestService.createMechanicInterest(
    customer.id,
    null,
    null,
    vehicleServices
  );

  /**
   * Send customer confirmation.
   */
  const notification =
    await notificationService.sendResidentialReservationConfirmation({
      serviceType,

      reservation,

      customer,

      address: inscription.address,
    });

  /**
   * =======================================================
   * GOOGLE SHEET
   * =======================================================
   *
   * Synchronize the completed residential request
   * with:
   *
   * Nouveau Residentiel
   *
   * IMPORTANT:
   *
   * We deliberately DO NOT await this call.
   *
   * Supabase is the source of truth.
   *
   * A Google Sheet failure must never cause
   * the customer's residential request to fail.
   */
  void syncTireEstimateToGoogleSheet({
    reservationId: reservation.id,
  }).catch((error) => {
    console.error("Tire request Google Sheet synchronization failed:", {
      reservationId: reservation.id,
      error,
    });
  });

  void syncReservationToGoogleSheet(reservation.id).catch((error) => {
    console.error("Residential Google Sheet synchronization failed:", {
      reservationId: reservation.id,

      error,
    });
  });

  return {
    reservation,
    customer,
    notification,
  };
}

/**
 * Fetches a reservation for the confirmation page.
 */
async function getReservationById(
  reservationId,
  reservationType,
  serviceType,
  token
) {
  const reservation = await reservationRepository.getReservationConfirmation({
    reservationId,
    reservationType,
    serviceType,
  });

  const hasValidToken = await reservationRepository.hasReservationAccess(
    reservationId,
    token
  );

  const [vehiclesRaw, tireRequest] = await Promise.all([
    reservationVehicleService.getVehiclesByReservationId(reservationId),

    reservationTireRepository.getTireRequestByReservationId(reservationId),
  ]);

  let upcomingReservations = [];

  /*
   * Only fetch and generate private confirmation URLs when the current
   * reservation token is valid.
   */
  if (hasValidToken) {
    const activeReservations =
      await reservationRepository.getActiveReservations(
        reservation.customer.id
      );

    upcomingReservations = reservationMapper.mapUpcomingReservations(
      activeReservations.filter(
        (activeReservation) => activeReservation.id !== reservationId
      ),
      getConfirmationUrl
    );
  }

  return reservationMapper.mapReservation({
    reservation,

    vehicles: reservationMapper.mapVehicles(vehiclesRaw),

    tireRequest,
    hasValidToken,
    upcomingReservations,
  });
}

/**
 * Cancels a reservation and notifies the waitlist when capacity opens.
 */
async function cancelReservationById({ reservationId, token }) {
  const reservation = await reservationRepository.validateReservationAccess(
    reservationId,
    token
  );

  /**
   * Already cancelled.
   */
  if (reservation.status === "cancelled") {
    return reservation;
  }

  assertResidentialReservationIsManageable(reservation);

  const updatedReservation = await reservationRepository.cancelReservation(
    reservationId
  );

  const customer = await customerService.getCustomerById(
    updatedReservation.customer_id
  );

  await notificationService.sendCancellationConfirmation({
    reservation: updatedReservation,
    customer,
  });

  if (updatedReservation.availability_id) {
    await waitlistService.notifyWaitlistForAvailability(
      updatedReservation.availability_id
    );
  }

  void syncReservationToGoogleSheet(reservationId).catch((error) => {
    console.error("Google Sheet cancellation sync failed:", {
      reservationId,
      error,
    });
  });

  return {
    reservation: updatedReservation,
    customer,
  };
}

/**
 * Changes the availability assigned to a company reservation.
 */
async function updateReservationAvailability({
  reservationId,
  availabilityId,
  token,
}) {
  /*
   * 1.
   * Vérifier que le client a accès
   * à cette réservation.
   */
  await reservationRepository.validateReservationAccess(reservationId, token);

  /*
   * 2.
   * Vérifier que la nouvelle disponibilité
   * est valide avant de modifier quoi que ce soit.
   */
  await availabilityService.validateAvailability(availabilityId);

  /*
   * 3.
   * IMPORTANT :
   *
   * Récupérer l'ANCIEN technicien
   * et l'ANCIEN onglet AVANT
   * de modifier availability_id.
   */
  const previousReservation =
    await reservationRepository.getReservationForGoogleSheet(reservationId);

  const previousTechnician =
    previousReservation.availability?.technician || null;

  const previousSheetTab =
    previousReservation.availability?.google_sheet_tab || null;

  /*
   * 4.
   * Modifier Supabase.
   *
   * Supabase reste notre source de vérité.
   */
  const updatedReservation =
    await reservationRepository.updateReservationAvailability(
      reservationId,
      availabilityId
    );

  /*
   * 5.
   * Synchronisation Google Sheet.
   *
   * PAS de await.
   *
   * Le client Angular ne doit pas attendre
   * après Google Sheets.
   */
  void syncReservationAvailabilityChange({
    reservationId,
    previousTechnician,
    previousSheetTab,
  }).catch((error) => {
    console.error("Google Sheet availability change sync failed:", {
      reservationId,
      availabilityId,
      previousTechnician,
      previousSheetTab,
      error,
    });
  });

  /*
   * 6.
   * Répondre immédiatement à Angular
   * avec le résultat Supabase.
   */
  return updatedReservation;
}

/**
 * =========================================================
 * UPDATE RESIDENTIAL WORKFLOW
 * =========================================================
 *
 * Used by customer service through Google Sheets.
 *
 * Updates:
 *
 * - reservations.status
 * - reservations.confirmed_date
 *
 * These fields may be updated independently.
 *
 * IMPORTANT:
 *
 * Sending the customer confirmation SMS is NOT handled
 * here. That will be a separate explicit action/button.
 */
async function updateResidentialWorkflow({
  reservationId,
  status,
  confirmedDate,
}) {
  /**
   * -------------------------------------------------------
   * Allowed residential workflow statuses.
   * -------------------------------------------------------
   *
   * Google Sheet labels will eventually map to these
   * stable database values.
   */
  const allowedStatuses = [
    "pending",
    "to_contact",
    "contacted",
    "waiting_response",
    "client_home_response",
    "second_reminder_sent",
    "third_reminder_sent",
    "no_response",
    "dates_sent",
    "waiting_confirmation",
    "confirmed",
    "contact_again",
    "cancelled",
    "not_interested",
    "sector_not_available",
  ];

  /**
   * -------------------------------------------------------
   * Reservation ID
   * -------------------------------------------------------
   */
  if (!reservationId) {
    const error = new Error("Reservation ID is required");

    error.status = 400;
    error.code = "RESERVATION_ID_REQUIRED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Status validation
   * -------------------------------------------------------
   *
   * Status is optional because the Sheet may update
   * only the confirmed date.
   */
  if (status !== undefined && status !== null) {
    const normalizedStatus = String(status).trim().toLowerCase();

    if (!allowedStatuses.includes(normalizedStatus)) {
      const error = new Error(`Invalid residential status: ${status}`);

      error.status = 400;
      error.code = "INVALID_RESIDENTIAL_STATUS";

      throw error;
    }

    status = normalizedStatus;
  }

  /**
   * -------------------------------------------------------
   * Confirmed date validation
   * -------------------------------------------------------
   *
   * confirmedDate may be:
   *
   * undefined
   *   -> don't change the existing value
   *
   * null / ""
   *   -> clear the existing confirmed date
   *
   * YYYY-MM-DD
   *   -> save the confirmed date
   */
  if (
    confirmedDate !== undefined &&
    confirmedDate !== null &&
    confirmedDate !== ""
  ) {
    const cleanDate = String(confirmedDate).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      const error = new Error("Confirmed date must use YYYY-MM-DD format");

      error.status = 400;
      error.code = "INVALID_CONFIRMED_DATE";

      throw error;
    }

    /**
     * Validate that it represents a real calendar date.
     *
     * Example:
     *
     * 2026-02-31
     *
     * must not be accepted.
     */
    const [year, month, day] = cleanDate.split("-").map(Number);

    const parsedDate = new Date(Date.UTC(year, month - 1, day));

    const isValidDate =
      parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 &&
      parsedDate.getUTCDate() === day;

    if (!isValidDate) {
      const error = new Error("Confirmed date is not a valid calendar date");

      error.status = 400;
      error.code = "INVALID_CONFIRMED_DATE";

      throw error;
    }

    confirmedDate = cleanDate;
  }

  /**
   * -------------------------------------------------------
   * Nothing to update
   * -------------------------------------------------------
   */
  if (status === undefined && confirmedDate === undefined) {
    const error = new Error(
      "At least one residential workflow field is required"
    );

    error.status = 400;
    error.code = "RESIDENTIAL_WORKFLOW_UPDATE_REQUIRED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Supabase update
   * -------------------------------------------------------
   */
  const updatedReservation =
    await reservationRepository.updateResidentialWorkflow({
      reservationId,

      status,

      confirmedDate,
    });

  return updatedReservation;
}

/**
 * =========================================================
 * SEND RESIDENTIAL CONFIRMED DATE SMS
 * =========================================================
 *
 * Called explicitly by customer service.
 *
 * This does NOT automatically run when the Sheet status
 * changes.
 *
 * Requirements:
 *
 * - residential reservation
 * - status === confirmed
 * - confirmed_date exists
 * - customer has a phone number
 *
 * Customer service may resend the confirmation if needed.
 */

async function sendResidentialConfirmedDateNotification({ reservationId }) {
  /**
   * -------------------------------------------------------
   * Reservation ID
   * -------------------------------------------------------
   */

  if (!reservationId) {
    const error = new Error("Reservation ID is required");

    error.status = 400;
    error.code = "RESERVATION_ID_REQUIRED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Always re-fetch from Supabase
   * -------------------------------------------------------
   *
   * IMPORTANT:
   *
   * We do not trust the values coming from Google Sheets.
   *
   * Supabase is checked immediately before sending.
   */

  const reservation = await reservationRepository.getReservationById(
    reservationId
  );

  /**
   * -------------------------------------------------------
   * Residential only
   * -------------------------------------------------------
   */

  if (
    String(reservation.reservation_type || "")
      .trim()
      .toLowerCase() !== "residential"
  ) {
    const error = new Error(
      "This notification is only available for residential reservations"
    );

    error.status = 400;
    error.code = "NOT_RESIDENTIAL_RESERVATION";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Status must be confirmed
   * -------------------------------------------------------
   */

  if (
    String(reservation.status || "")
      .trim()
      .toLowerCase() !== "confirmed"
  ) {
    const error = new Error(
      "The residential reservation must have the status Date confirmée before sending the confirmation SMS"
    );

    error.status = 409;
    error.code = "RESIDENTIAL_NOT_CONFIRMED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Confirmed date required
   * -------------------------------------------------------
   */

  if (!reservation.confirmed_date) {
    const error = new Error(
      "A confirmed date is required before sending the confirmation SMS"
    );

    error.status = 409;
    error.code = "RESIDENTIAL_CONFIRMED_DATE_REQUIRED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Customer
   * -------------------------------------------------------
   */

  const customer = await customerService.getCustomerById(
    reservation.customer_id
  );

  if (!customer?.phone) {
    const error = new Error("The customer does not have a phone number");

    error.status = 400;
    error.code = "CUSTOMER_PHONE_REQUIRED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Send through Twilio
   * -------------------------------------------------------
   */

  const sms = await notificationService.sendResidentialConfirmedDateSms({
    reservation,
    customer,
  });

  /**
   * -------------------------------------------------------
   * Twilio did not accept the message
   * -------------------------------------------------------
   */

  if (!sms || sms.sent !== true) {
    const error = new Error(
      sms?.error?.message ||
        "The residential confirmation SMS could not be sent"
    );

    error.status = 502;
    error.code =
      sms?.reason || sms?.error?.code || "RESIDENTIAL_CONFIRMATION_SMS_FAILED";

    throw error;
  }

  /**
   * -------------------------------------------------------
   * Success
   * -------------------------------------------------------
   */

  return {
    sent: true,

    reservationId: reservation.id,

    confirmedDate: reservation.confirmed_date,

    customer: {
      id: customer.id,

      firstName: customer.first_name,

      lastName: customer.last_name,

      phone: customer.phone,
    },

    sms: {
      messageId: sms.messageId,

      providerStatus: sms.providerStatus,

      confirmationUrl: sms.confirmationUrl,
    },
  };
}

/**
 * Used by company availability fetching to identify appointments that the
 * customer already has.
 */
async function getActiveReservations(customerId) {
  return reservationRepository.getActiveReservations(customerId);
}

/**
 * Adds one vehicle to an existing reservation.
 */
async function addVehicleToReservation({
  reservationId,
  token,
  vehicleService,
  availabilityId,
}) {
  const reservation = await reservationRepository.validateReservationAccess(
    reservationId,
    token
  );

  assertResidentialReservationIsManageable(reservation);

  /*
   * Prefer the reservation's actual availability ID. The request parameter
   * remains supported temporarily for compatibility.
   */
  const effectiveAvailabilityId = reservation.availability_id || availabilityId;

  if (effectiveAvailabilityId) {
    await availabilityService.validateAvailability(effectiveAvailabilityId);
  }

  const createdVehicles = await reservationVehicleService.createVehicles(
    reservationId,
    [vehicleService]
  );

  await reservationRepository.recalculateServiceCount(reservationId);

  await tirePurchaseRequestService.createTireRequestFromReservation({
    reservation,
    vehicleServices: createdVehicles,
  });

  /*
   * Synchronise la réservation avec
   * la fiche du technicien.
   *
   * Le nouveau véhicule aura son propre
   * reservationVehicleId, donc Apps Script
   * créera une nouvelle ligne uniquement
   * pour ce véhicule.
   */
  void syncReservationToGoogleSheet(reservationId).catch((error) => {
    console.error("Google Sheet add vehicle sync failed:", {
      reservationId,
      error,
    });
  });

  return getVehiclesAndTireRequest(reservationId);
}

/**
 * Removes one vehicle from an existing reservation.
 */
async function removeVehicleFromReservation({
  reservationId,
  vehicleId,
  token,
}) {
  const reservation = await reservationRepository.validateReservationAccess(
    reservationId,
    token
  );

  assertResidentialReservationIsManageable(reservation);

  /*
   * Remove the tire-request vehicle
   * before deleting the reservation vehicle.
   */
  await tirePurchaseRequestService.removeVehicleFromTireRequest({
    reservationId,
    reservationVehicleId: vehicleId,
  });

  await reservationVehicleService.removeVehicle({
    reservationId,
    vehicleId,
  });

  await reservationRepository.recalculateServiceCount(reservationId);

  /*
   * Remove the corresponding row
   * from the technician Google Sheet.
   *
   * The Supabase deletion has already
   * succeeded, so a Google failure must
   * not make the API operation fail.
   */
  void removeVehicleFromGoogleSheet(reservationId, vehicleId).catch((error) => {
    console.error("Google Sheet remove vehicle sync failed:", {
      reservationId,
      vehicleId,
      error,
    });
  });

  if (reservation.availability_id) {
    await waitlistService.notifyWaitlistForAvailability(
      reservation.availability_id
    );
  }
}

/**
 * Updates one vehicle, its selected services and all service answers.
 */
async function updateVehicleInReservation({
  reservationId,
  vehicleId,
  token,
  vehicleService,
}) {
  const reservation = await reservationRepository.validateReservationAccess(
    reservationId,
    token
  );

  assertResidentialReservationIsManageable(reservation);

  const vehiclesRaw = await reservationVehicleService.updateVehicle({
    reservationId,
    vehicleId,
    vehicleService,
  });

  const tireRequestVehicle =
    await tirePurchaseRequestService.syncTireRequestVehicleFromReservationVehicle(
      {
        reservationId,
        reservationVehicleId: vehicleId,
        vehicleService,
      }
    );

  await reservationRepository.recalculateServiceCount(reservationId);

  /*
   * Synchronise la réservation avec
   * la fiche du technicien.
   *
   * Comme le reservationVehicleId reste
   * le même, Apps Script mettra à jour
   * la bonne ligne sans en créer une nouvelle.
   */
  void syncReservationToGoogleSheet(reservationId).catch((error) => {
    console.error("Google Sheet update vehicle sync failed:", {
      reservationId,
      vehicleId,
      error,
    });
  });

  return {
    vehicles: reservationMapper.mapVehicles(vehiclesRaw),
    tireRequestVehicle,
  };
}

/**
 * Fetches the two pieces needed after adding a reservation vehicle.
 */
async function getVehiclesAndTireRequest(reservationId) {
  const [vehiclesRaw, tireRequest] = await Promise.all([
    reservationVehicleService.getVehiclesByReservationId(reservationId),

    reservationTireRepository.getTireRequestByReservationId(reservationId),
  ]);

  return reservationMapper.mapVehiclesAndTireRequest(
    reservationMapper.mapVehicles(vehiclesRaw),
    tireRequest
  );
}

function countSelectedServices(vehicleServices) {
  return (vehicleServices || []).reduce(
    (total, vehicleService) => total + (vehicleService.serviceIds?.length || 0),
    0
  );
}

function assertResidentialReservationIsManageable(reservation) {
  // Can check for user permission in the future to allow staff to modify
  const isLocked =
    reservation.reservation_type === "residential" &&
    reservation.status === "confirmed" &&
    Boolean(reservation.confirmed_date);

  if (isLocked) {
    throw new AppError(
      "Confirmed residential appointments cannot be modified online.",
      {
        status: 409,
        code: "RESIDENTIAL_MODIFICATION_LOCKED",
        meta: {
          reservationId: reservation.id,
          confirmedDate: reservation.confirmed_date,
        },
      }
    );
  }
}

module.exports = {
  createCompanyReservation,
  createResidentialReservation,
  getReservationById,
  cancelReservationById,
  updateReservationAvailability,
  updateResidentialWorkflow,
  sendResidentialConfirmedDateNotification,
  getActiveReservations,
  addVehicleToReservation,
  removeVehicleFromReservation,
  updateVehicleInReservation,
};
