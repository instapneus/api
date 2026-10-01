const express = require("express");
const router = express.Router();
const companyController = require("./../controllers/company.controller");

// Route to get all companies
router.get("/", companyController.getCompanies);

// Route to get company locations
router.get("/:companyId/locations", companyController.getCompanyLocations);

// Route to get company availabilities by location
router.get(
  "/:companyId/availabilities/:locationId",
  companyController.getCompanyAvailabilitiesByLocation
);

module.exports = router;
