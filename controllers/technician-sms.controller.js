const {
  sendTechnicianSms,
} = require("../services/reservation/technician-sms.service");

/**
 * =========================================================
 * SEND TECHNICIAN SMS CONTROLLER
 * =========================================================
 *
 * Called by the central Google Apps Script.
 *
 * Endpoint:
 *
 * POST /api/notifications/technician-sms
 */

async function sendTechnicianSmsController(req, res) {
  try {
    const {
      reservationId,
      reservationVehicleId,
      phone,
      vehicleLabel,
      message,
      initialContact = false,
      technician = null,
      spreadsheetId = null,
      sheetTab = null,
    } = req.body || {};

    /**
     * =====================================
     * SEND
     * =====================================
     */

    const result = await sendTechnicianSms({
      reservationId,

      reservationVehicleId,

      phone,

      vehicleLabel,

      message,

      initialContact: initialContact === true,

      technician,

      spreadsheetId,

      sheetTab,
    });

    /**
     * =====================================
     * SUCCESS
     * =====================================
     *
     * Even a duplicate-protected
     * initial message returns HTTP 200.
     *
     * Example:
     *
     * sent: false
     * skipped: true
     */

    return res.status(200).json({
      success: true,

      ...result,
    });
  } catch (error) {
    console.error("Technician SMS error:", error);

    /**
     * =====================================
     * ERROR
     * =====================================
     */

    return res.status(400).json({
      success: false,

      message: error.message || "Technician SMS failed",
    });
  }
}

module.exports = {
  sendTechnicianSmsController,
};
