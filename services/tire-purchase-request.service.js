const supabase = require("../config/supabase");
const AppError = require("../errors/app-error");

const { formatAddress } = require("../helpers/formatAddress");

/*
|--------------------------------------------------------------------------
| Shared helpers
|--------------------------------------------------------------------------
*/

function extractTireVehicles(vehicleServices) {
  return vehicleServices.filter(
    (vehicleService) => vehicleService.tires?.wantTires
  );
}

function mapTireVehicleRows(tirePurchaseRequestId, vehicles) {
  return vehicles.map((vehicle) => ({
    tire_purchase_request_id: tirePurchaseRequestId,
    reservation_vehicle_id: vehicle.reservationVehicleId,
    year: vehicle.carSelection.year,
    brand: vehicle.carSelection.brand?.name || null,
    model: vehicle.carSelection.model?.name || null,
    tire_condition: vehicle.tires.condition || null,
    width: vehicle.tires.width?.width || null,
    profile: vehicle.tires.profile?.profile || null,
    diameter: vehicle.tires.diameter?.diameter || null,
  }));
}

async function getExistingTireRequest(reservationId) {
  const { data, error } = await supabase
    .from("tire_purchase_requests")
    .select("id")
    .eq("reservation_id", reservationId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function createTireRequestFromCompanyReservation(
  customerId,
  companyId,
  locationId,
  reservationId,
  vehicleServices
) {
  const vehicles = extractTireVehicles(vehicleServices);

  if (!vehicles.length) return null;

  const { data: request, error } = await supabase
    .from("tire_purchase_requests")
    .insert({
      customer_id: customerId,
      company_id: companyId,
      location_id: locationId,
      reservation_id: reservationId,
      source: "company_reservation",
      status: "new",
      service_location: "company",
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create tire purchase request", {
      status: 500,
      code: "CREATE_TIRE_REQUEST_FAILED",
      meta: error,
    });
  }

  const rows = mapTireVehicleRows(request.id, vehicles);

  const { error: vehiclesError } = await supabase
    .from("tire_purchase_request_vehicles")
    .insert(rows);

  if (vehiclesError) {
    throw new AppError("Failed to create tire request vehicles", {
      status: 500,
      code: "CREATE_TIRE_REQUEST_VEHICLES_FAILED",
      meta: vehiclesError,
    });
  }

  return request;
}

async function createTireRequestFromResidentialReservation(
  customerId,
  reservationId,
  address,
  vehicleServices
) {
  const vehicles = extractTireVehicles(vehicleServices);

  if (!vehicles.length) return null;

  const homeAddress = formatAddress(address);

  const { data: request, error } = await supabase
    .from("tire_purchase_requests")
    .insert({
      customer_id: customerId,
      reservation_id: reservationId,
      source: "residential_reservation",
      status: "new",
      service_location: homeAddress,
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create tire purchase request", {
      status: 500,
      code: "CREATE_TIRE_REQUEST_FAILED",
      meta: error,
    });
  }

  const rows = mapTireVehicleRows(request.id, vehicles);

  const { error: vehiclesError } = await supabase
    .from("tire_purchase_request_vehicles")
    .insert(rows);

  if (vehiclesError) {
    throw new AppError("Failed to create tire request vehicles", {
      status: 500,
      code: "CREATE_TIRE_REQUEST_VEHICLES_FAILED",
      meta: vehiclesError,
    });
  }

  return request;
}

async function createTireRequestFromReservation({
  reservation,
  vehicleServices,
}) {
  const vehicles = extractTireVehicles(vehicleServices);

  if (!vehicles.length) return null;

  let request = await getExistingTireRequest(reservation.id);

  if (!request) {
    const payload =
      reservation.reservation_type === "company"
        ? {
            customer_id: reservation.customer_id,
            company_id: reservation.company_id,
            location_id: reservation.location_id,
            reservation_id: reservation.id,
            source: "company_reservation",
            status: "new",
            service_location: "company",
          }
        : {
            customer_id: reservation.customer_id,
            reservation_id: reservation.id,
            source: "residential_reservation",
            status: "new",
            service_location: formatAddress(reservation.home_address),
          };

    const { data, error } = await supabase
      .from("tire_purchase_requests")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    request = data;
  }

  const rows = mapTireVehicleRows(request.id, vehicles);

  const { error: vehiclesError } = await supabase
    .from("tire_purchase_request_vehicles")
    .insert(rows);

  if (vehiclesError) throw vehiclesError;

  return request;
}

async function createStandaloneTireRequest(
  customerId,
  carIdentification,
  language
) {
  const car = carIdentification?.carSelection;
  const tireSize = carIdentification?.tireSize;
  const tireSeason = carIdentification?.tireSeason;
  const tireDelivery = carIdentification?.tireDelivery;

  if (!car) {
    throw new AppError("Vehicle information is required", {
      status: 400,
      code: "TIRE_ESTIMATE_VEHICLE_REQUIRED",
    });
  }

  /*
   * Keep the location in a human-readable format.
   *
   * Examples:
   *
   * Entreprise / Valnet
   * Domicile / Laval
   */
  const serviceLocation =
    tireDelivery?.location === "Entreprise"
      ? `Entreprise / ${tireDelivery.companyName || ""}`
      : `${tireDelivery?.location || "Domicile"} / ${tireDelivery?.city || ""}`;

  /*
   * Create the main tire purchase request.
   *
   * No reservation_id because this request
   * comes directly from the tire estimate form.
   */
  const { data: request, error } = await supabase
    .from("tire_purchase_requests")
    .insert({
      customer_id: customerId,

      reservation_id: null,
      company_id: null,
      location_id: null,

      source: "tire_estimate",
      status: "new",

      service_location: serviceLocation,

      notes: carIdentification?.comments || null,
      language: language || null,
    })
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to create tire estimate request", {
      status: 500,
      code: "CREATE_TIRE_ESTIMATE_FAILED",
      meta: error,
    });
  }

  /*
   * A standalone estimate does not have a
   * reservation_vehicle_id.
   */
  const { data: vehicle, error: vehicleError } = await supabase
    .from("tire_purchase_request_vehicles")
    .insert({
      tire_purchase_request_id: request.id,

      reservation_vehicle_id: null,

      year: car.year,
      brand: car.brand?.name || null,
      model: car.model?.name || null,

      tire_type: tireSeason?.type || null,
      tire_condition: tireSeason?.condition || null,

      width: tireSize?.width?.width || null,
      profile: tireSize?.profile?.profile || null,
      diameter: tireSize?.diameter?.diameter || null,
    })
    .select()
    .single();

  if (vehicleError) {
    throw new AppError("Failed to create tire estimate vehicle", {
      status: 500,
      code: "CREATE_TIRE_ESTIMATE_VEHICLE_FAILED",
      meta: vehicleError,
    });
  }

  return {
    request,
    vehicle,
  };
}

async function removeVehicleFromTireRequest({
  reservationId,
  reservationVehicleId,
}) {
  const { data: tireVehicleRows, error: tireVehicleFetchError } = await supabase
    .from("tire_purchase_request_vehicles")
    .select("id, tire_purchase_request_id")
    .eq("reservation_vehicle_id", reservationVehicleId);

  if (tireVehicleFetchError) {
    throw new AppError("Failed to fetch tire request vehicles", {
      status: 500,
      code: "TIRE_REQUEST_VEHICLES_FETCH_FAILED",
      meta: tireVehicleFetchError,
    });
  }

  if (!tireVehicleRows?.length) {
    return null;
  }

  const tireRequestId = tireVehicleRows[0].tire_purchase_request_id;

  const { error: tireVehicleDeleteError } = await supabase
    .from("tire_purchase_request_vehicles")
    .delete()
    .eq("reservation_vehicle_id", reservationVehicleId);

  if (tireVehicleDeleteError) {
    throw new AppError("Failed to delete tire request vehicle", {
      status: 500,
      code: "TIRE_REQUEST_VEHICLE_DELETE_FAILED",
      meta: tireVehicleDeleteError,
    });
  }

  const { data: remainingVehicles, error: remainingFetchError } = await supabase
    .from("tire_purchase_request_vehicles")
    .select("id")
    .eq("tire_purchase_request_id", tireRequestId);

  if (remainingFetchError) {
    throw new AppError("Failed to fetch remaining tire request vehicles", {
      status: 500,
      code: "TIRE_REQUEST_VEHICLES_FETCH_FAILED",
      meta: remainingFetchError,
    });
  }

  if (!remainingVehicles?.length) {
    const { error: requestDeleteError } = await supabase
      .from("tire_purchase_requests")
      .delete()
      .eq("id", tireRequestId)
      .eq("reservation_id", reservationId);

    if (requestDeleteError) {
      throw new AppError("Failed to delete tire purchase request", {
        status: 500,
        code: "TIRE_REQUEST_DELETE_FAILED",
        meta: requestDeleteError,
      });
    }
  }

  return {
    tireRequestId,
    reservationVehicleId,
  };
}

async function syncTireRequestVehicleFromReservationVehicle({
  reservationId,
  reservationVehicleId,
  vehicleService,
}) {
  const { data: tireRequestVehicle, error: fetchError } = await supabase
    .from("tire_purchase_request_vehicles")
    .select("id")
    .eq("reservation_vehicle_id", reservationVehicleId)
    .maybeSingle();

  if (fetchError) {
    throw new AppError("Failed to fetch tire request vehicle", {
      status: 500,
      code: "TIRE_REQUEST_VEHICLES_FETCH_FAILED",
      meta: fetchError,
    });
  }

  // If no tire request vehicle exists yet, do nothing here.
  // The create flow should handle creating new tire request vehicles.
  if (!tireRequestVehicle) {
    return null;
  }

  const tires = vehicleService.tires;

  const { data, error } = await supabase
    .from("tire_purchase_request_vehicles")
    .update({
      year: vehicleService.carSelection.year,
      brand: vehicleService.carSelection.brand.name,
      model: vehicleService.carSelection.model.name,
    })
    .eq("id", tireRequestVehicle.id)
    .select()
    .single();

  if (error) {
    throw new AppError("Failed to update tire request vehicle", {
      status: 500,
      code: "TIRE_REQUEST_VEHICLE_UPDATE_FAILED",
      meta: error,
    });
  }
  return data;
}

async function getStandaloneTireRequestById(tirePurchaseRequestId) {
  const { data: request, error: requestError } = await supabase
    .from("tire_purchase_requests")
    .select("*")
    .eq("id", tirePurchaseRequestId)
    .eq("source", "tire_estimate")
    .maybeSingle();

  if (requestError) {
    throw new AppError("Failed to fetch tire purchase request", {
      status: 500,
      code: "TIRE_ESTIMATE_FETCH_FAILED",
      meta: requestError,
    });
  }

  if (!request) {
    throw new AppError("Tire estimate not found", {
      status: 404,
      code: "TIRE_ESTIMATE_NOT_FOUND",
    });
  }

  const { data: vehicle, error: vehicleError } = await supabase
    .from("tire_purchase_request_vehicles")
    .select("*")
    .eq("tire_purchase_request_id", tirePurchaseRequestId)
    .maybeSingle();

  if (vehicleError) {
    throw new AppError("Failed to fetch tire estimate vehicle", {
      status: 500,
      code: "TIRE_ESTIMATE_VEHICLE_FETCH_FAILED",
      meta: vehicleError,
    });
  }

  return {
    request,
    vehicle,
  };
}

module.exports = {
  createTireRequestFromCompanyReservation,
  createTireRequestFromResidentialReservation,
  createTireRequestFromReservation,
  createStandaloneTireRequest,
  removeVehicleFromTireRequest,
  syncTireRequestVehicleFromReservationVehicle,
  getStandaloneTireRequestById,
};
