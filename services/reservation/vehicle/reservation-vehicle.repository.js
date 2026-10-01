const supabase = require("../../../config/supabase");
const AppError = require("../../../errors/app-error");

/**
 * Creates one reservation vehicle.
 */
async function createVehicle(reservationId, vehicleService) {
  const { carSelection } = vehicleService;

  const { data, error } = await supabase
    .from("reservation_vehicles")
    .insert({
      reservation_id: reservationId,
      year: carSelection.year,
      brand: carSelection.brand.name,
      brand_id: carSelection.brand.id,
      model: carSelection.model.name,
      model_id: carSelection.model.id,
      color: carSelection.color || null,
      engine_size: carSelection.engineSize || null,
      comments: vehicleService.comments?.trim() || null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new AppError("Failed to create reservation vehicle", {
      status: 500,
      code: "CREATE_RESERVATION_VEHICLE_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * Updates the main information for one reservation vehicle.
 */
async function updateVehicle(vehicleId, vehicleService) {
  const { carSelection } = vehicleService;

  const { data, error } = await supabase
    .from("reservation_vehicles")
    .update({
      year: carSelection.year,
      brand: carSelection.brand.name,
      brand_id: carSelection.brand.id,
      model: carSelection.model.name,
      model_id: carSelection.model.id,
      color: carSelection.color || null,
      engine_size: carSelection.engineSize || null,
      comments: vehicleService.comments?.trim() || null,
    })
    .eq("id", vehicleId)
    .select()
    .single();

  if (error || !data) {
    throw new AppError("Failed to update reservation vehicle", {
      status: 500,
      code: "UPDATE_RESERVATION_VEHICLE_FAILED",
      meta: error,
    });
  }

  return data;
}

/**
 * Verifies that a vehicle belongs to the requested reservation.
 *
 * The selected-service rows are returned so the caller can determine the
 * number of services removed.
 */
async function getVehicle(reservationId, vehicleId) {
  const { data, error } = await supabase
    .from("reservation_vehicles")
    .select(
      `
        id,
        reservation_id,

        selected_services:reservation_vehicle_services(
          id,
          service_id
        )
      `
    )
    .eq("id", vehicleId)
    .eq("reservation_id", reservationId)
    .maybeSingle();

  if (error) {
    throw new AppError("Failed to fetch reservation vehicle", {
      status: 500,
      code: "RESERVATION_VEHICLE_FETCH_FAILED",
      meta: error,
    });
  }

  if (!data) {
    throw new AppError("Vehicle not found in reservation", {
      status: 404,
      code: "VEHICLE_NOT_FOUND",
      meta: {
        reservationId,
        vehicleId,
      },
    });
  }

  return data;
}

/**
 * Fetches every vehicle, selected service and service answer for a reservation.
 */
async function getVehiclesByReservationId(reservationId) {
  const { data, error } = await supabase
    .from("reservation_vehicles")
    .select(
      `
        id,
        year,
        brand,
        brand_id,
        model,
        model_id,
        color,
        engine_size,
        comments,

        selected_services:reservation_vehicle_services(
          id,
          service_id,

          service:services(
            id,
            name,
            name_fr,
            name_en,
            code,
            category,
            price
          ),

          answers:reservation_vehicle_service_answers(
            id,
            question_id,
            option_id,
            value_text,
            value_number,
            value_boolean,

            question:service_questions(
              id,
              code,
              input_type,
              label_fr,
              label_en
            ),

            option:service_question_options(
              id,
              code,
              label_fr,
              label_en,
              price_adjustment
            )
          )
        )
      `
    )
    .eq("reservation_id", reservationId);

  if (error) {
    throw new AppError("Failed to fetch reservation vehicles", {
      status: 500,
      code: "RESERVATION_VEHICLES_FETCH_FAILED",
      meta: error,
    });
  }

  return data || [];
}

/**
 * Creates the selected-service rows for one vehicle.
 *
 * Returning id and service_id is required because answer rows reference
 * reservation_vehicle_services.id.
 */
async function createSelectedServices(reservationVehicleId, serviceIds) {
  if (!serviceIds?.length) {
    return [];
  }

  const rows = serviceIds.map((serviceId) => ({
    reservation_vehicle_id: reservationVehicleId,
    service_id: serviceId,
  }));

  const { data, error } = await supabase
    .from("reservation_vehicle_services")
    .insert(rows)
    .select("id, service_id");

  if (error) {
    throw new AppError("Failed to create vehicle services", {
      status: 500,
      code: "CREATE_VEHICLE_SERVICES_FAILED",
      meta: error,
    });
  }

  return data || [];
}

/**
 * Deletes every selected service belonging to one vehicle.
 *
 * Answer rows should be deleted automatically through ON DELETE CASCADE.
 */
async function deleteSelectedServices(vehicleId) {
  const { error } = await supabase
    .from("reservation_vehicle_services")
    .delete()
    .eq("reservation_vehicle_id", vehicleId);

  if (error) {
    throw new AppError("Failed to delete vehicle services", {
      status: 500,
      code: "VEHICLE_SERVICES_DELETE_FAILED",
      meta: error,
    });
  }
}

/**
 * Deletes one vehicle from a reservation.
 */
async function deleteVehicle(reservationId, vehicleId) {
  const { error } = await supabase
    .from("reservation_vehicles")
    .delete()
    .eq("id", vehicleId)
    .eq("reservation_id", reservationId);

  if (error) {
    throw new AppError("Failed to delete vehicle", {
      status: 500,
      code: "VEHICLE_DELETE_FAILED",
      meta: error,
    });
  }
}

module.exports = {
  createVehicle,
  updateVehicle,
  getVehicle,
  getVehiclesByReservationId,
  createSelectedServices,
  deleteSelectedServices,
  deleteVehicle,
};
