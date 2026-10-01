const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

async function getAvailabilityUsage(availabilityId) {
  const { data: reservations, error } = await supabase
    .from("reservations")
    .select("service_count")
    .eq("availability_id", availabilityId)
    .neq("status", "cancelled");

  if (error) {
    throw new AppError("Failed to calculate availability usage", {
      status: 500,
      code: "AVAILABILITY_USAGE_FETCH_FAILED",
      meta: error,
    });
  }

  const usedServices = reservations.reduce(
    (sum, reservation) => sum + (reservation.service_count || 0),
    0
  );

  return usedServices;
}

async function validateAvailability(availabilityId) {
  const capacity = await getAvailabilityCapacity(availabilityId);

  if (!capacity.hasSpace) {
    throw new AppError("No availability left", {
      status: 409,
      code: "AVAILABILITY_FULL",
      meta: {
        availabilityId,
        max: capacity.availability.max_services,
        used: capacity.usedServices,
        remaining: capacity.remainingServices,
      },
    });
  }

  return {
    ...capacity.availability,
    used_services: capacity.usedServices,
    remaining_services: capacity.remainingServices,
    is_full: !capacity.hasSpace,
  };
}

async function getAvailabilityCapacity(availabilityId) {
  const { data: availability, error } = await supabase
    .from("company_availabilities")
    .select("*")
    .eq("id", availabilityId)
    .single();

  if (error) {
    throw new AppError("Failed to fetch availability", {
      status: 500,
      code: "AVAILABILITY_FETCH_FAILED",
      meta: error,
    });
  }

  const usedServices = await getAvailabilityUsage(availabilityId);
  const remainingServices = availability.max_services - usedServices;

  return {
    availability,
    usedServices,
    remainingServices,
    hasSpace: remainingServices > 0,
  };
}

module.exports = {
  getAvailabilityUsage,
  validateAvailability,
  getAvailabilityCapacity,
};
