const companyService = require("../services/company.service");
const asyncHandler = require("./../utils/asyncHandelr");

// Companies
const getCompanies = asyncHandler(async (req, res) => {
  const data = await companyService.getCompanies(req.query.code);
  res.json({ success: true, data });
});

// Locations
const getCompanyLocations = asyncHandler(async (req, res) => {
  const data = await companyService.getCompanyLocations(req.params.companyId);
  res.json({ success: true, data });
});

// Availabilities
const getCompanyAvailabilitiesByLocation = asyncHandler(async (req, res) => {
  const { companyId, locationId } = req.params;
  const { email } = req.query;

  const data = await companyService.getCompanyAvailabilities(
    companyId,
    locationId,
    email
  );

  res.json({ success: true, data });
});

module.exports = {
  getCompanies,
  getCompanyLocations,
  getCompanyAvailabilitiesByLocation,
};
