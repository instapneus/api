const supabase = require("./../config/supabase");
const AppError = require("./../errors/app-error");

const availabilityService = require("./availability.service");
const customerService = require("./customer.service");
const reservationService = require("./reservation/reservation.service");
const waitlistService = require("./waitlist.service");

// Get companies
async function getCompanies(code) {
  let query = supabase.from("companies").select("*").eq("is_active", true);

  if (code) {
    const normalizedCode = code.toString().trim().toLowerCase();
    query = query.ilike("code", normalizedCode);
  }

  let { data, error } = await query.order("name", {
    ascending: true,
  });

  if (error) {
    throw new AppError("Failed to fetch companies", {
      status: 500,
      code: "COMPANIES_FETCH_FAILED",
      meta: error,
    });
  }

  if (code && (!data || data.length === 0)) {
    const fallback = await supabase
      .from("companies")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (fallback.error) {
      throw new AppError("Failed to fetch fallback companies", {
        status: 500,
        code: "COMPANIES_FALLBACK_FAILED",
        meta: fallback.error,
      });
    }

    data = fallback.data;
  }

  return data;
}

// Get locations
async function getCompanyLocations(companyId) {
  const { data, error } = await supabase
    .from("company_locations")
    .select("*")
    .eq("company_id", companyId);

  if (error) {
    throw new AppError("Failed to fetch company locations", {
      status: 500,
      code: "COMPANY_LOCATIONS_FETCH_FAILED",
      meta: error,
    });
  }

  return data;
}

// Get availabilities
async function getCompanyAvailabilities(companyId, locationId, email) {
  const today = new Date().toISOString().split("T")[0];

  let activeReservations = [];
  let waitlistEntries = [];

  const { data: availabilities, error } = await supabase
    .from("company_availabilities")
    .select("*, location:company_locations(*)")
    .eq("company_id", companyId)
    .eq("location_id", locationId)
    .eq("is_active", true)
    .gte("appointment_date", today)
    .order("appointment_date", { ascending: true });

  if (error) {
    throw new AppError("Failed to fetch availabilities", {
      status: 500,
      code: "AVAILABILITIES_FETCH_FAILED",
      meta: error,
    });
  }

  // customer lookup by email
  if (email) {
    const normalizedEmail = email.trim().toLowerCase();
    const customer = await customerService.getCustomerByEmail(normalizedEmail);

    if (customer) {
      activeReservations = await reservationService.getActiveReservations(
        customer.id
      );
    }

    waitlistEntries = await waitlistService.getActiveWaitlistEntries(
      normalizedEmail
    );
  }

  const availabilitiesWithCapacity = await Promise.all(
    availabilities.map(async (availability) => {
      const usedServices = await availabilityService.getAvailabilityUsage(
        availability.id
      );

      const remainingSpots = availability.max_services - usedServices;

      const existingReservation = activeReservations.find(
        (reservation) => reservation.availability_id === availability.id
      );

      const waitlistEntry = waitlistEntries.find(
        (entry) => entry.availability_id === availability.id
      );

      return {
        ...availability,
        used_services: usedServices,
        remaining_spots: remainingSpots,
        is_full: remainingSpots <= 0,

        has_existing_reservation: !!existingReservation,
        waitlist_status: waitlistEntry?.status || null,
      };
    })
  );

  return availabilitiesWithCapacity;
}

module.exports = {
  getCompanies,
  getCompanyLocations,
  getCompanyAvailabilities,
};
