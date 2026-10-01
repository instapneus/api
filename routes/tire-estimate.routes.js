const express = require("express");

const tireEstimateController = require("../controllers/tire-estimate.controller");

const router = express.Router();

router.post("/", tireEstimateController.createTireEstimate);

router.get("/:tirePurchaseRequestId", tireEstimateController.getTireEstimate);

module.exports = router;
