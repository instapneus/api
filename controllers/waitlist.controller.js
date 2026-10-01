// controllers/waitlist.controller.js
const waitlistService = require("../services/waitlist.service");

async function joinWaitlist(req, res) {
  try {
    const { availabilityId } = req.params;

    const result = await waitlistService.joinAvailabilityWaitlist({
      availabilityId,
      user: req.body.user,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      message: err.message,
      code: err.code || "WAITLIST_JOIN_FAILED",
      meta: err.meta || null,
    });
  }
}

module.exports = {
  joinWaitlist,
};
