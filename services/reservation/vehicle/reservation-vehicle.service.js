const AppError = require("../../../errors/app-error");

const vehicleRepository = require("./reservation-vehicle.repository");

const serviceAnswerService = require("./reservation-service-answer.service");

/**
 * Creates all vehicles, selected services and service answers belonging to
 * a reservation.
 *
 * Used by company, residential, mechanic and residential-mechanic flows.
 */
async function createVehicles(reservationId, vehicleServices) {
  validateVehicleServiceList(vehicleServices);

  const uniqueServiceIds = getUniqueServiceIds(vehicleServices);

  const questionsByServiceId =
    await serviceAnswerService.getQuestionsByServiceIds(uniqueServiceIds);

  const createdVehicles = [];

  for (const vehicleService of vehicleServices) {
    validateVehicleService(vehicleService);

    const vehicle = await vehicleRepository.createVehicle(
      reservationId,
      vehicleService
    );

    const createdServices = await vehicleRepository.createSelectedServices(
      vehicle.id,
      vehicleService.serviceIds
    );

    await serviceAnswerService.createAnswers({
      vehicleService,
      createdServices,
      questionsByServiceId,
    });

    /*
     * Tire-request creation needs the generated reservation vehicle ID,
     * together with the original frontend vehicle data.
     */
    createdVehicles.push({
      reservationVehicleId: vehicle.id,
      ...vehicleService,
    });
  }

  return createdVehicles;
}

/**
 * Updates a vehicle and completely replaces its selected services and answers.
 */
async function updateVehicle({ reservationId, vehicleId, vehicleService }) {
  validateVehicleService(vehicleService);

  // Ensures the vehicle belongs to the reservation.
  await vehicleRepository.getVehicle(reservationId, vehicleId);

  const questionsByServiceId =
    await serviceAnswerService.getQuestionsByServiceIds(
      vehicleService.serviceIds
    );

  await vehicleRepository.updateVehicle(vehicleId, vehicleService);

  /*
   * Removing selected-service rows should also remove their answers through
   * the foreign key ON DELETE CASCADE.
   */
  await vehicleRepository.deleteSelectedServices(vehicleId);

  const createdServices = await vehicleRepository.createSelectedServices(
    vehicleId,
    vehicleService.serviceIds
  );

  await serviceAnswerService.createAnswers({
    vehicleService,
    createdServices,
    questionsByServiceId,
  });

  return vehicleRepository.getVehiclesByReservationId(reservationId);
}

/**
 * Removes a vehicle and its selected services.
 */
async function removeVehicle({ reservationId, vehicleId }) {
  const vehicle = await vehicleRepository.getVehicle(reservationId, vehicleId);

  const removedServiceCount = vehicle.selected_services?.length || 0;

  await vehicleRepository.deleteSelectedServices(vehicleId);

  await vehicleRepository.deleteVehicle(reservationId, vehicleId);

  return {
    removedServiceCount,
  };
}

async function getVehiclesByReservationId(reservationId) {
  return vehicleRepository.getVehiclesByReservationId(reservationId);
}

function getUniqueServiceIds(vehicleServices) {
  return [
    ...new Set(
      vehicleServices.flatMap(
        (vehicleService) => vehicleService.serviceIds || []
      )
    ),
  ];
}

function validateVehicleServiceList(vehicleServices) {
  if (!Array.isArray(vehicleServices) || vehicleServices.length === 0) {
    throw new AppError("At least one vehicle is required", {
      status: 400,
      code: "MISSING_VEHICLES",
    });
  }
}

function validateVehicleService(vehicleService) {
  if (!vehicleService?.carSelection) {
    throw new AppError("Missing vehicle information", {
      status: 400,
      code: "MISSING_VEHICLE_INFORMATION",
    });
  }

  if (
    !Array.isArray(vehicleService.serviceIds) ||
    vehicleService.serviceIds.length === 0
  ) {
    throw new AppError("Vehicle must contain at least one service", {
      status: 400,
      code: "INVALID_SERVICE_IDS",
    });
  }
}

module.exports = {
  createVehicles,
  updateVehicle,
  removeVehicle,
  getVehiclesByReservationId,
};
