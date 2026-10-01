const {
  handleTwilioMessageStatus,
} = require("../services/reservation-notification/reservation-notification.service");

/**
 * =========================================================
 * TWILIO MESSAGE STATUS CALLBACK
 * =========================================================
 */
async function handleMessageStatus(req, res) {
  try {
    const { MessageSid, MessageStatus, ErrorCode, ErrorMessage } = req.body;

    await handleTwilioMessageStatus({
      messageSid: MessageSid,

      messageStatus: MessageStatus,

      errorCode: ErrorCode || null,

      errorMessage: ErrorMessage || null,
    });

    /**
     * Twilio only needs a successful
     * HTTP response from us.
     */
    return res.status(200).send("OK");
  } catch (error) {
    console.error("Twilio message status webhook failed:", error);

    return res.status(500).send("ERROR");
  }
}

module.exports = {
  handleMessageStatus,
};
