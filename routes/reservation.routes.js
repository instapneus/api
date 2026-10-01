const express = require("express");
const crypto = require("crypto");

const router = express.Router();

const reservationController = require("../controllers/reservation.controller");

/**
 * =========================================================
 * GOOGLE SHEET AUTH
 * =========================================================
 */

function requireGoogleSheetSecret(req, res, next) {
  const expectedSecret = String(
    process.env.GOOGLE_SHEET_SYNC_SECRET || ""
  ).trim();

  const providedSecret = String(
    req.get("x-google-sheet-secret") || req.body?.secret || ""
  ).trim();

  if (!expectedSecret) {
    console.error("GOOGLE_SHEET_SYNC_SECRET is not configured");

    return res.status(500).json({
      success: false,

      message: "Google Sheet authentication is not configured",
    });
  }

  if (!providedSecret) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  const expectedBuffer = Buffer.from(expectedSecret, "utf8");

  const providedBuffer = Buffer.from(providedSecret, "utf8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  next();
}

/**
 * =========================================================
 * CREATE RESERVATIONS
 * =========================================================
 */

router.post("/company", reservationController.createCompany);

router.post("/residential", reservationController.createResidential);

/**
 * =========================================================
 * RESIDENTIAL CUSTOMER-SERVICE WORKFLOW
 * =========================================================
 */

router.patch(
  "/:reservationId/residential-workflow",
  requireGoogleSheetSecret,
  reservationController.updateResidentialWorkflow
);

/**
 * =========================================================
 * RESIDENTIAL CONFIRMATION SMS
 * =========================================================
 *
 * Called explicitly from the residential Google Sheet.
 *
 * Body:
 *
 * {
 *   "secret": "..."
 * }
 */

router.post(
  "/:reservationId/residential-confirmation-sms",
  requireGoogleSheetSecret,
  reservationController.sendResidentialConfirmationSms
);

/**
 * =========================================================
 * GET RESERVATION
 * =========================================================
 */

router.get("/:reservationId", reservationController.getById);

/**
 * =========================================================
 * CANCEL / AVAILABILITY
 * =========================================================
 */

router.patch("/:reservationId/cancel", reservationController.cancelReservation);

router.patch(
  "/:reservationId/availability/:availabilityId",
  reservationController.updateAvailability
);

/**
 * =========================================================
 * VEHICLES
 * =========================================================
 */

router.post("/:reservationId/vehicles", reservationController.addVehicle);

router.delete(
  "/:reservationId/vehicles/:vehicleId",
  reservationController.removeVehicle
);

router.patch(
  "/:reservationId/vehicles/:vehicleId",
  reservationController.updateVehicle
);

module.exports = router;
