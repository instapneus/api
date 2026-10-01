const express = require("express");
const router = express.Router();
const serviceController = require("../controllers/service.controller");

// GET /api/services?category=tire
router.get("/", serviceController.getServices);

module.exports = router;
