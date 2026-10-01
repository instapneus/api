const {
  sendVehicleReadyBatch,
} = require("../services/reservation-notification/reservation-notification.service");

async function sendVehicleReadyBatchController(req, res) {
  try {
    const { vehicles, technician, spreadsheetId, sheetTab } = req.body;

    if (!Array.isArray(vehicles)) {
      return res.status(400).json({
        success: false,
        message: "vehicles must be an array",
      });
    }

    if (vehicles.length === 0) {
      return res.status(200).json({
        success: true,
        summary: {
          total: 0,
          sent: 0,
          skipped: 0,
          failed: 0,
        },
        results: [],
      });
    }

    const result = await sendVehicleReadyBatch({
      vehicles,
      technician: technician || null,

      spreadsheetId: spreadsheetId || null,

      sheetTab: sheetTab || null,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Vehicle ready batch failed:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "Failed to send vehicle ready notifications",
    });
  }
}

module.exports = {
  sendVehicleReadyBatchController,
};
