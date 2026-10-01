const AppError = require("../errors/app-error");

const customerService = require("./customer.service");
const tirePurchaseRequestService = require("./tire-purchase-request.service");
const {
  syncTireEstimateToGoogleSheet,
} = require("./google-sheet/tire-estimate-sheet-sync.service");

/*
|--------------------------------------------------------------------------
| Mappers
|--------------------------------------------------------------------------
*/

function mapCustomer(customer) {
  return {
    id: customer.id,
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    createdAt: customer.created_at,
  };
}

function mapTireVehicle(vehicle) {
  if (!vehicle) {
    return null;
  }

  return {
    id: vehicle.id,

    year: vehicle.year,
    brand: vehicle.brand,
    model: vehicle.model,

    tireSeason: vehicle.tire_type || vehicle.tire_season || null,

    tireCondition: vehicle.tire_condition || null,

    width: vehicle.width || null,
    profile: vehicle.profile || null,
    diameter: vehicle.diameter || null,

    reservationVehicleId: vehicle.reservation_vehicle_id || null,

    createdAt: vehicle.created_at,
  };
}

function mapTireRequest(tireRequest) {
  const request = tireRequest.request;
  const vehicle = mapTireVehicle(tireRequest.vehicle);

  return {
    id: request.id,

    source: request.source,
    status: request.status,

    serviceLocation: request.service_location,

    notes: request.notes,
    language: request.language,

    createdAt: request.created_at,

    vehicles: vehicle ? [vehicle] : [],
  };
}

function mapTireEstimate(customer, tireRequest) {
  return {
    customer: mapCustomer(customer),
    tireRequest: mapTireRequest(tireRequest),
  };
}

/*
|--------------------------------------------------------------------------
| Create
|--------------------------------------------------------------------------
*/

async function createTireEstimate(payload) {
  const { inscription, carIdentification, language } = payload;

  if (!inscription?.user) {
    throw new AppError("Customer information is required", {
      status: 400,
      code: "TIRE_ESTIMATE_CUSTOMER_REQUIRED",
    });
  }

  if (!carIdentification?.carSelection) {
    throw new AppError("Vehicle information is required", {
      status: 400,
      code: "TIRE_ESTIMATE_VEHICLE_REQUIRED",
    });
  }

  const customer = await customerService.upsertCustomer(inscription.user);

  const tireRequest =
    await tirePurchaseRequestService.createStandaloneTireRequest(
      customer.id,
      carIdentification,
      language
    );

  void syncTireEstimateToGoogleSheet({
    tirePurchaseRequestId: tireRequest.request.id,
  }).catch((error) => {
    console.error("Tire estimate Google Sheet synchronization failed:", {
      tirePurchaseRequestId: tireRequest.request.id,
      error,
    });
  });

  return mapTireEstimate(customer, tireRequest);
}

/*
|--------------------------------------------------------------------------
| Get
|--------------------------------------------------------------------------
*/

async function getTireEstimate(tirePurchaseRequestId) {
  const tireRequest =
    await tirePurchaseRequestService.getStandaloneTireRequestById(
      tirePurchaseRequestId
    );

  const customer = await customerService.getCustomerById(
    tireRequest.request.customer_id
  );

  return mapTireEstimate(customer, tireRequest);
}

module.exports = {
  createTireEstimate,
  getTireEstimate,
};
