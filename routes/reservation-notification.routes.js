const express = require("express");

const {
  sendVehicleReadyBatchController,
} = require("../controllers/reservation-notification.controller");

const {
  sendTechnicianSmsController,
} = require("../controllers/technician-sms.controller");

const {
  processCompanyRemindersController,
} = require("../controllers/company-reminder.controller");

const router = express.Router();

/**
 * =========================================================
 * GOOGLE SHEET AUTH
 * =========================================================
 */

function requireGoogleSheetSecret(req, res, next) {
  const headerSecret = String(req.get("x-google-sheet-secret") || "").trim();

  const bodySecret = String(req.body?.secret || "").trim();

  const providedSecret = headerSecret || bodySecret;

  const expectedSecret = String(
    process.env.GOOGLE_SHEET_SYNC_SECRET || ""
  ).trim();

  /**
   * Server configuration problem.
   */
  if (!expectedSecret) {
    console.error("GOOGLE_SHEET_SYNC_SECRET is not configured");

    return res.status(500).json({
      success: false,
      message: "Google Sheet authentication is not configured",
    });
  }

  /**
   * Helpful diagnostics WITHOUT
   * printing the actual secret.
   */
  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  next();
}

/**
 * =========================================================
 * REMINDER CRON AUTHENTICATION
 * =========================================================
 */

function requireReminderCronSecret(req, res, next) {
  const providedSecret = String(req.get("x-reminder-cron-secret") || "").trim();

  const expectedSecret = String(process.env.REMINDER_CRON_SECRET || "").trim();

  if (!expectedSecret) {
    console.error("REMINDER_CRON_SECRET is not configured");

    return res.status(500).json({
      success: false,
      message: "Reminder authentication is not configured",
    });
  }

  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }

  next();
}

/**
 * =========================================================
 * EXISTING VEHICLE READY BATCH
 * =========================================================
 */

router.post(
  "/vehicle-ready/batch",
  requireGoogleSheetSecret,
  sendVehicleReadyBatchController
);

/**
 * =========================================================
 * SAME-ROW TECHNICIAN SMS
 * =========================================================
 */

router.post(
  "/technician-sms",
  requireGoogleSheetSecret,
  sendTechnicianSmsController
);

router.post(
  "/company-reminders/run",
  requireReminderCronSecret,
  processCompanyRemindersController
);

module.exports = router;
