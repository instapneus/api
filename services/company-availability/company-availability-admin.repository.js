const supabase = require("../../config/supabase");
const AppError = require("../../errors/app-error");

const availabilityService = require("../availability.service");
const waitlistService = require("../waitlist.service");
const { getGoogleSpreadsheetId } = require("../../config/google-sheet.config");

/**
 * =========================================================
 * GET COMPANY / LOCATION REFERENCES
 * =========================================================
 *
 * Used by the Google Sheet:
 *
 * Configuration des dates entreprises
 *
 * We return every company and every company location,
 * whether or not an availability already exists.
 */
async function getCompanyAvailabilityReferences() {
  const [
    { data: companies, error: companiesError },
    { data: locations, error: locationsError },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select(
        `
        id,
        name
      `
      )
      .order("name", { ascending: true }),

    supabase
      .from("company_locations")
      .select(
        `
        id,
        company_id,
        name
      `
      )
      .order("name", { ascending: true }),
  ]);

  if (companiesError) {
    throw new AppError("Failed to fetch companies", {
      status: 500,
      code: "COMPANIES_FETCH_FAILED",
      meta: companiesError,
    });
  }

  if (locationsError) {
    throw new AppError("Failed to fetch company locations", {
      status: 500,
      code: "COMPANY_LOCATIONS_FETCH_FAILED",
      meta: locationsError,
    });
  }

  return {
    companies: companies || [],
    locations: locations || [],
  };
}

/**
 * =========================================================
 * CREATE COMPANY AVAILABILITY
 * =========================================================
 */
async function createCompanyAvailability({
  companyId,
  locationId,
  appointmentDate,
  maxServices,
  googleSheetTab,
  technician,
  serviceType,
  availableFrom,
  availableTo,
}) {
  const { data, error } = await supabase
    .from("company_availabilities")
    .insert({
      company_id: companyId,
      location_id: locationId,
      appointment_date: appointmentDate,
      max_services: maxServices,
      google_sheet_tab: googleSheetTab,
      technician,
      service_type: serviceType,
      available_from: availableFrom,
      available_to: availableTo,
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create company availability", {
      status: 500,
      code: "CREATE_COMPANY_AVAILABILITY_FAILED",
      meta: error,
    });
  }

  return data;
}

async function updateCompanyAvailability(
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
) {
  const { data, error } = await supabase
    .from("company_availabilities")
    .update({
      company_id: companyId,
      location_id: locationId,
      appointment_date: appointmentDate,
      max_services: maxServices,
      google_sheet_tab: googleSheetTab,
      technician,
      service_type: serviceType,
      available_from: availableFrom,
      available_to: availableTo,
    })
    .eq("id", availabilityId)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to update company availability", {
      status: 500,
      code: "UPDATE_COMPANY_AVAILABILITY_FAILED",
      meta: error,
    });
  }

  return data;
}

async function getCompanyAvailabilitiesDashboard() {
  const today = new Date().toISOString().split("T")[0];
  
  const { data: availabilities, error } = await supabase
    .from("company_availabilities")
    .select(`
      id,
      company_id,
      location_id,
      appointment_date,
      max_services,
      is_active,
      available_from,
      available_to,
      service_type,
      technician,

      company:companies (
        id,
        name,
        code
      ),

      location:company_locations (
        id,
        name,
        address
      )
    `)
    .eq("is_active", true)
    .gte("appointment_date", today)
    .order("appointment_date", { ascending: true });

  if (error) {
    throw new AppError("Failed to fetch company availability dashboard", {
      status: 500,
      code: "COMPANY_AVAILABILITY_DASHBOARD_FETCH_FAILED",
      meta: error,
    });
  }

  const dashboardData = await Promise.all(
    (availabilities || []).map(async (availability) => {
      const [
        usedServices,
        waitlistCount,
        waitlist
      ] = await Promise.all([
        availabilityService.getAvailabilityUsage(availability.id),
        waitlistService.getWaitlistCountForAvailability(availability.id),
        waitlistService.getWaitlistForAvailability(availability.id),
      ]);

      const spreadsheet =
        getTechnicianSpreadsheet(
          availability.technician
        );

      const remainingSpots = Math.max(
        availability.max_services - usedServices,
        0
      );

      const fillPercentage =
        availability.max_services > 0
          ? Math.round(
              (usedServices / availability.max_services) * 100
            )
          : 0;

      const fillStatus = getAvailabilityFillStatus(fillPercentage);

      return {
        ...availability,

        used_services: usedServices,
        remaining_spots: remainingSpots,
        waitlist_count: waitlistCount,
        fill_percentage: fillPercentage,
        fill_status: fillStatus,
        has_waitlist: waitlistCount > 0,
        waitlist,
        is_full: usedServices >= availability.max_services,
        spreadsheet,
      };
    })
  );

  return dashboardData;
}

async function getCompanyAvailabilityDetails(availabilityId) {
  const { data: availability, error } = await supabase
    .from("company_availabilities")
    .select(`
      id,
      company_id,
      location_id,
      appointment_date,
      max_services,
      is_active,
      available_from,
      available_to,
      service_type,
      technician,

      company:companies (
        id,
        name,
        code
      ),

      location:company_locations (
        id,
        name,
        address
      )
    `)
    .eq("id", availabilityId)
    .single();

  if (error) {
    throw new AppError("Failed to fetch company availability details", {
      status: 500,
      code: "COMPANY_AVAILABILITY_DETAILS_FETCH_FAILED",
      meta: error,
    });
  }

  if (!availability) {
    throw new AppError("Company availability not found", {
      status: 404,
      code: "COMPANY_AVAILABILITY_NOT_FOUND",
    });
  }

  const [
  usedServices,
  waitlistCount,
  waitlist
] = await Promise.all([
  availabilityService.getAvailabilityUsage(availability.id),
  waitlistService.getWaitlistCountForAvailability(availability.id),
  waitlistService.getWaitlistForAvailability(availability.id),
]);

  const remainingSpots = Math.max(
    availability.max_services - usedServices,
    0
  );

  const fillPercentage =
    availability.max_services > 0
      ? Math.round(
          (usedServices / availability.max_services) * 100
        )
      : 0;

  return {
    ...availability,

    used_services: usedServices,
    remaining_spots: remainingSpots,

    fill_percentage: fillPercentage,
    fill_status: getAvailabilityFillStatus(fillPercentage),

    waitlist_count: waitlistCount,
    has_waitlist: waitlistCount > 0,
    waitlist,

    is_full: usedServices >= availability.max_services,
  };
}

function getAvailabilityFillStatus(fillPercentage) {
  if (fillPercentage >= 100) {
    return "full";
  }

  if (fillPercentage >= 80) {
    return "almost_full";
  }

  if (fillPercentage >= 50) {
    return "filling";
  }

  return "low";
}

function getTechnicianSpreadsheet(technician) {
  if (!technician) {
    return null;
  }

  const spreadsheetId =
    getGoogleSpreadsheetId(technician);

  if (!spreadsheetId) {
    return null;
  }

  return {
    name: technician,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

module.exports = {
  getCompanyAvailabilityReferences,
  createCompanyAvailability,
  updateCompanyAvailability,
  getCompanyAvailabilitiesDashboard,
  getCompanyAvailabilityDetails,
};
