const express = require("express");

const twilio = require("twilio");

const {
  handleMessageStatus,
} = require("../controllers/twilio-webhook.controller");

const router = express.Router();

/**
 * Twilio sends message status callbacks
 * as application/x-www-form-urlencoded.
 */
router.post(
  "/message-status",

  express.urlencoded({
    extended: false,
  }),

  twilio.webhook({
    protocol: "https",
  }),

  handleMessageStatus
);

module.exports = router;
