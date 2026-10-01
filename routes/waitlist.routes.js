// routes/waitlist.routes.js
const express = require("express");
const router = express.Router();
const waitlistController = require("../controllers/waitlist.controller");

router.post("/availabilities/:availabilityId", waitlistController.joinWaitlist);

module.exports = router;
