const reservationService = require("../services/reservation/reservation.service");

const asyncHandler = require("../utils/asyncHandelr");

/**
 * =========================================================
 * CREATE COMPANY RESERVATION
 * =========================================================
 */

const createCompany = asyncHandler(async (req, res) => {
  const data = await reservationService.createCompanyReservation(req.body);

  res.status(201).json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * CREATE RESIDENTIAL RESERVATION
 * =========================================================
 */

const createResidential = asyncHandler(async (req, res) => {
  const data = await reservationService.createResidentialReservation(req.body);

  res.status(201).json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * GET RESERVATION
 * =========================================================
 */

const getById = asyncHandler(async (req, res) => {
  const { reservationId } = req.params;

  const { reservationType, serviceType, token } = req.query;

  const data = await reservationService.getReservationById(
    reservationId,
    reservationType,
    serviceType,
    token
  );

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * CANCEL RESERVATION
 * =========================================================
 */

const cancelReservation = asyncHandler(async (req, res) => {
  const reservationId = req.params.reservationId;

  const { token } = req.body;

  const result = await reservationService.cancelReservationById({
    reservationId,
    token,
  });

  res.json({
    success: true,
    data: result,
  });
});

/**
 * =========================================================
 * UPDATE COMPANY AVAILABILITY
 * =========================================================
 */

const updateAvailability = asyncHandler(async (req, res) => {
  const { reservationId, availabilityId } = req.params;

  const { token } = req.body;

  const data = await reservationService.updateReservationAvailability({
    reservationId,
    availabilityId,
    token,
  });

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * UPDATE RESIDENTIAL WORKFLOW
 * =========================================================
 *
 * Called by Google Apps Script when customer service
 * changes:
 *
 * - Statut du suivi
 * - Date confirmée
 */

const updateResidentialWorkflow = asyncHandler(async (req, res) => {
  const { reservationId } = req.params;

  const { status, confirmedDate } = req.body;

  const data = await reservationService.updateResidentialWorkflow({
    reservationId,
    status,
    confirmedDate,
  });

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * SEND RESIDENTIAL CONFIRMATION SMS
 * =========================================================
 *
 * Explicit customer-service action.
 *
 * Node will re-check Supabase before sending:
 *
 * - residential reservation
 * - status = confirmed
 * - confirmed_date exists
 * - customer phone exists
 */

const sendResidentialConfirmationSms = asyncHandler(async (req, res) => {
  const { reservationId } = req.params;

  const data =
    await reservationService.sendResidentialConfirmedDateNotification({
      reservationId,
    });

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * ADD VEHICLE
 * =========================================================
 */

const addVehicle = asyncHandler(async (req, res) => {
  const { reservationId } = req.params;

  const { token, vehicleService, availabilityId } = req.body;

  const data = await reservationService.addVehicleToReservation({
    reservationId,
    token,
    vehicleService,
    availabilityId,
  });

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * REMOVE VEHICLE
 * =========================================================
 */

const removeVehicle = asyncHandler(async (req, res) => {
  const { reservationId, vehicleId } = req.params;

  const { token } = req.body;

  const data = await reservationService.removeVehicleFromReservation({
    reservationId,
    vehicleId,
    token,
  });

  res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * UPDATE VEHICLE
 * =========================================================
 */

const updateVehicle = asyncHandler(async (req, res) => {
  const { reservationId, vehicleId } = req.params;

  const { token, vehicleService } = req.body;

  const data = await reservationService.updateVehicleInReservation({
    reservationId,
    vehicleId,
    token,
    vehicleService,
  });

  return res.json({
    success: true,
    data,
  });
});

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  createCompany,
  createResidential,
  getById,
  cancelReservation,
  updateAvailability,
  updateResidentialWorkflow,
  sendResidentialConfirmationSms,
  addVehicle,
  removeVehicle,
  updateVehicle,
};
