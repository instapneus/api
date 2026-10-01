const companyAvailabilityRepository = require("../services/company-availability/company-availability-admin.repository");
const waitlistService = require("../services/waitlist.service");

async function getCompanyAvailabilityReferencesController(req, res) {
  try {
    const data =
      await companyAvailabilityRepository.getCompanyAvailabilityReferences();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Company availability references error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.message || "Failed to fetch company availability references",
      code: error.code || null,
    });
  }
}

async function createCompanyAvailabilityController(req, res) {
  try {
    const {
      companyId,
      locationId,
      appointmentDate,
      maxServices,
      googleSheetTab,
      technician,
      serviceType,
      availableFrom,
      availableTo,
    } = req.body;

    if (
      !companyId ||
      !locationId ||
      !appointmentDate ||
      !maxServices ||
      !googleSheetTab ||
      !technician ||
      !serviceType ||
      !availableFrom ||
      !availableTo
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required availability information",
      });
    }

    const availability =
      await companyAvailabilityRepository.createCompanyAvailability({
        companyId,
        locationId,
        appointmentDate,
        maxServices,
        googleSheetTab,
        technician,
        serviceType,
        availableFrom,
        availableTo,
      });

    return res.status(201).json({
      success: true,
      data: availability,
    });
  } catch (error) {
    console.error("Create company availability error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to create company availability",
      code: error.code || null,
    });
  }
}

async function updateCompanyAvailabilityController(req, res) {
  try {
    const availabilityId = String(req.params.availabilityId || "").trim();

    const {
      companyId,
      locationId,
      appointmentDate,
      maxServices,
      googleSheetTab,
      technician,
      serviceType,
      availableFrom,
      availableTo,
    } = req.body;

    if (!availabilityId) {
      return res.status(400).json({
        success: false,
        message: "Availability ID is required",
      });
    }

    if (
      !companyId ||
      !locationId ||
      !appointmentDate ||
      !maxServices ||
      !googleSheetTab ||
      !technician ||
      !serviceType ||
      !availableFrom ||
      !availableTo
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required availability information",
      });
    }

    const availability =
      await companyAvailabilityRepository.updateCompanyAvailability(
        availabilityId,
        {
          companyId,
          locationId,
          appointmentDate,
          maxServices,
          googleSheetTab,
          technician,
          serviceType,
          availableFrom,
          availableTo,
        }
      );

    return res.status(200).json({
      success: true,
      data: availability,
    });
  } catch (error) {
    console.error("Update company availability error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to update company availability",
      code: error.code || null,
    });
  }
}

async function getCompanyAvailabilitiesDashboardController(req, res) {
  try {
    const data =
      await companyAvailabilityRepository.getCompanyAvailabilitiesDashboard();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Company availability dashboard error:", error);

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.message || "Failed to fetch company availability dashboard",
      code: error.code || null,
    });
  }
}

async function getCompanyAvailabilityDetailsController(req, res) {
  try {
    const { availabilityId } = req.params;

    const data =
      await companyAvailabilityRepository.getCompanyAvailabilityDetails(
        availabilityId
      );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error(
      "Company availability details error:",
      error
    );

    return res.status(error.status || 500).json({
      success: false,
      message:
        error.message ||
        "Failed to fetch company availability details",
      code: error.code || null,
    });
  }
}

async function updateWaitlistStatusController(
  req,
  res
) {
  try {
    const { waitlistId } = req.params;
    const { status } = req.body;

    const data =
      await waitlistService.updateWaitlistStatus(
        waitlistId,
        status
      );

    return res.status(200).json({
      success: true,
      message: "Waitlist status updated",
      data,
    });

  } catch (error) {

    console.error(
      "Waitlist status update error:",
      error
    );

    return res
      .status(error.status || 500)
      .json({
        success: false,
        message:
          error.message ||
          "Failed to update waitlist status",
        code: error.code || null,
      });
  }
}

module.exports = {
  getCompanyAvailabilityReferencesController,
  createCompanyAvailabilityController,
  updateCompanyAvailabilityController,
  getCompanyAvailabilitiesDashboardController,
  getCompanyAvailabilityDetailsController,
  updateWaitlistStatusController,
};
