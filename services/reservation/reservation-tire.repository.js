const supabase = require("../../config/supabase");
const AppError = require("../../errors/app-error");

/**
 * Fetches the tire purchase request associated with a reservation.
 */
async function getTireRequestByReservationId(reservationId) {
  const { data: request, error } = await supabase
    .from("tire_purchase_requests")
    .select(
      `
        id,
        status,
        service_location,
        notes,
        created_at,
        company_id,
        location_id,
        reservation_id,

        vehicles:tire_purchase_request_vehicles(
          id,
          reservation_vehicle_id,
          year,
          brand,
          model,
          tire_season,
          tire_condition,
          width,
          profile,
          diameter
        )
      `
    )
    .eq("reservation_id", reservationId)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch tire purchase request", {
      status: 500,
      code: "FETCH_TIRE_REQUEST_FAILED",
      meta: error,
    });
  }

  if (!request) {
    return null;
  }

  return {
    id: request.id,
    status: request.status,
    serviceLocation: request.service_location,
    notes: request.notes,
    createdAt: request.created_at,

    companyId: request.company_id,
    locationId: request.location_id,
    reservationId: request.reservation_id,

    vehicles: (request.vehicles || []).map((vehicle) => ({
      id: vehicle.id,

      reservation_vehicle_id: vehicle.reservation_vehicle_id,

      year: vehicle.year,
      brand: vehicle.brand,
      model: vehicle.model,

      tireSeason: vehicle.tire_season,
      tireCondition: vehicle.tire_condition,

      width: vehicle.width,
      profile: vehicle.profile,
      diameter: vehicle.diameter,
    })),
  };
}

module.exports = {
  getTireRequestByReservationId,
};
