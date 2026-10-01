const {
  processCompanyReminders,
} = require("../services/reminder/company-reminder.service");

/**
 * =========================================================
 * PROCESS COMPANY REMINDERS
 * =========================================================
 *
 * Internal endpoint called by the reminder cron.
 */

async function processCompanyRemindersController(req, res) {
  try {
    const result = await processCompanyReminders();

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("Company reminder processing failed:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Company reminder processing failed",
      code: error.code || "COMPANY_REMINDER_PROCESSING_FAILED",
    });
  }
}

module.exports = {
  processCompanyRemindersController,
};
