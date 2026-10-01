const express = require("express");

const {
  getCompanyAvailabilityReferencesController,
  createCompanyAvailabilityController,
  updateCompanyAvailabilityController,
  getCompanyAvailabilitiesDashboardController,
  getCompanyAvailabilityDetailsController,
  updateWaitlistStatusController,
} = require("../controllers/company-availability-admin.controller");

const router = express.Router();

/**
 * Only our Google Sheet should be able to use
 * these administrative endpoints.
 */
function requireGoogleSheetSecret(req, res, next) {
  const providedSecret = String(req.get("x-instapneus-secret") || "").trim();

  const expectedSecret = String(
    process.env.GOOGLE_SHEET_SYNC_SECRET || ""
  ).trim();

  if (!expectedSecret) {
    console.error("GOOGLE_SHEET_SYNC_SECRET is not configured");

    return res.status(500).json({
      success: false,
      message: "Google Sheet authentication is not configured",
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

router.get(
  "/references",
  requireGoogleSheetSecret,
  getCompanyAvailabilityReferencesController
);

router.get(
  "/dashboard",
  getCompanyAvailabilitiesDashboardController
);

router.patch(
  "/waitlist/:waitlistId/status",
  updateWaitlistStatusController
);

router.get(
  "/:availabilityId",
  getCompanyAvailabilityDetailsController
);

router.post("/", requireGoogleSheetSecret, createCompanyAvailabilityController);

router.patch(
  "/:availabilityId",
  requireGoogleSheetSecret,
  updateCompanyAvailabilityController
);

module.exports = router;
