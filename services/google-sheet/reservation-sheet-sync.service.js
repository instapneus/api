const reservationRepository = require("../reservation/reservation.repository");

const reservationVehicleService = require("../reservation/vehicle/reservation-vehicle.service");

const {
  formatReservationForGoogleSheet,
  formatResidentialReservationForGoogleSheet,
} = require("./google-sheet.formatter");

const googleSheetService = require("./google-sheet.service");

/**
 * =========================================================
 * RESIDENTIAL GOOGLE SHEET
 * =========================================================
 */

const RESIDENTIAL_SPREADSHEET_ID =
  "1iwSMitNzzfH4UOzFDELWtdA52AxY5LR_jviy2TIDhxA";

const RESIDENTIAL_SHEET_TAB = "Nouveau Residentiel";

/**
 * =========================================================
 * MAIN GOOGLE SHEET SYNC
 * =========================================================
 *
 * Automatically routes according to:
 *
 * reservation.reservation_type
 *
 * COMPANY:
 * - Technician spreadsheet
 * - One row per vehicle
 *
 * RESIDENTIAL:
 * - Nouveau Residentiel
 * - One row per reservation
 */

async function syncReservationToGoogleSheet(reservationId) {
  const reservation = await reservationRepository.getReservationForGoogleSheet(
    reservationId
  );

  if (isResidentialReservation(reservation)) {
    return syncResidentialReservationToGoogleSheet(reservationId, reservation);
  }

  return syncCompanyReservationToGoogleSheet(reservationId, reservation);
}

/**
 * =========================================================
 * RESERVATION TYPE
 * =========================================================
 */

function isResidentialReservation(reservation) {
  return (
    String(reservation?.reservation_type || "")
      .trim()
      .toLowerCase() === "residential"
  );
}

/**
 * =========================================================
 * COMPANY SYNC
 * =========================================================
 *
 * Existing behavior:
 *
 * ONE Google Sheet row per vehicle.
 */

async function syncCompanyReservationToGoogleSheet(
  reservationId,
  existingReservation = null
) {
  const reservationPromise = existingReservation
    ? Promise.resolve(existingReservation)
    : reservationRepository.getReservationForGoogleSheet(reservationId);

  const [reservation, vehicles] = await Promise.all([
    reservationPromise,

    reservationVehicleService.getVehiclesByReservationId(reservationId),
  ]);

  const technician = reservation.availability?.technician;

  const sheetTab = reservation.availability?.google_sheet_tab;

  if (!technician) {
    throw new Error(
      `Aucun technicien configuré pour la réservation ${reservationId}`
    );
  }

  if (!sheetTab) {
    throw new Error(
      `Aucun onglet Google Sheet configuré pour la réservation ${reservationId}`
    );
  }

  const reservationForSheet = {
    ...reservation,

    vehicles,
  };

  const rows = formatReservationForGoogleSheet(reservationForSheet);

  const results = [];

  for (const row of rows) {
    const result = await googleSheetService.upsertReservation({
      technician,

      sheetTab,

      row,
    });

    results.push(result);
  }

  return results;
}

/**
 * =========================================================
 * RESIDENTIAL SYNC
 * =========================================================
 *
 * Residential uses:
 *
 * ONE Google Sheet row per reservation.
 *
 * All vehicles and requested services
 * are combined inside the
 * "Services demandés" column.
 */

async function syncResidentialReservationToGoogleSheet(
  reservationId,
  existingReservation = null
) {
  const reservationPromise = existingReservation
    ? Promise.resolve(existingReservation)
    : reservationRepository.getReservationForGoogleSheet(reservationId);

  const [reservation, vehicles] = await Promise.all([
    reservationPromise,

    reservationVehicleService.getVehiclesByReservationId(reservationId),
  ]);

  const residentialForSheet = {
    ...reservation,

    vehicles,

    /**
     * Actual residential address field.
     */
    address: reservation.home_address || "",
  };

  const row = formatResidentialReservationForGoogleSheet(residentialForSheet);

  return googleSheetService.upsertResidentialReservation({
    spreadsheetId: RESIDENTIAL_SPREADSHEET_ID,

    sheetTab: RESIDENTIAL_SHEET_TAB,

    row,
  });
}

/**
 * =========================================================
 * REMOVE VEHICLE FROM GOOGLE SHEET
 * =========================================================
 *
 * COMPANY:
 *
 * Delete the vehicle row.
 *
 *
 * RESIDENTIAL:
 *
 * Do NOT delete the residential reservation row.
 *
 * The vehicle has already been removed from Supabase.
 * We simply rebuild the residential row using the
 * remaining vehicles.
 */

async function removeVehicleFromGoogleSheet(
  reservationId,
  reservationVehicleId
) {
  const reservation = await reservationRepository.getReservationForGoogleSheet(
    reservationId
  );

  /**
   * =======================================================
   * RESIDENTIAL
   * =======================================================
   */

  if (isResidentialReservation(reservation)) {
    return syncResidentialReservationToGoogleSheet(reservationId, reservation);
  }

  /**
   * =======================================================
   * COMPANY
   * =======================================================
   */

  const technician = reservation.availability?.technician;

  const sheetTab = reservation.availability?.google_sheet_tab;

  if (!technician) {
    throw new Error(
      `Aucun technicien configuré pour la réservation ${reservationId}`
    );
  }

  if (!sheetTab) {
    throw new Error(
      `Aucun onglet Google Sheet configuré pour la réservation ${reservationId}`
    );
  }

  return googleSheetService.removeReservationVehicle({
    technician,

    sheetTab,

    reservationVehicleId,
  });
}

/**
 * =========================================================
 * COMPANY AVAILABILITY CHANGE
 * =========================================================
 *
 * Normally this is only used by
 * company reservations.
 *
 * Residential routing is still included
 * defensively.
 */

async function syncReservationAvailabilityChange({
  reservationId,
  previousTechnician,
  previousSheetTab,
}) {
  const [reservation, vehicles] = await Promise.all([
    reservationRepository.getReservationForGoogleSheet(reservationId),

    reservationVehicleService.getVehiclesByReservationId(reservationId),
  ]);

  /**
   * =======================================================
   * DEFENSIVE RESIDENTIAL ROUTING
   * =======================================================
   */

  if (isResidentialReservation(reservation)) {
    return syncResidentialReservationToGoogleSheet(reservationId, reservation);
  }

  /**
   * =======================================================
   * COMPANY DESTINATION
   * =======================================================
   */

  const newTechnician = reservation.availability?.technician;

  const newSheetTab = reservation.availability?.google_sheet_tab;

  if (!newTechnician) {
    throw new Error(
      `Aucun technicien configuré pour la réservation ${reservationId}`
    );
  }

  if (!newSheetTab) {
    throw new Error(
      `Aucun onglet Google Sheet configuré pour la réservation ${reservationId}`
    );
  }

  const destinationChanged =
    previousTechnician !== newTechnician || previousSheetTab !== newSheetTab;

  const reservationForSheet = {
    ...reservation,

    vehicles,
  };

  const rows = formatReservationForGoogleSheet(reservationForSheet);

  const results = [];

  /**
   * =========================================================
   * SAME COMPANY DESTINATION
   * =========================================================
   */

  if (!destinationChanged) {
    for (const row of rows) {
      const result = await googleSheetService.upsertReservation({
        technician: newTechnician,

        sheetTab: newSheetTab,

        row,
      });

      results.push({
        action: "updated",

        reservationVehicleId: row.reservationVehicleId,

        result,
      });
    }

    return {
      moved: false,

      previousTechnician,

      previousSheetTab,

      newTechnician,

      newSheetTab,

      results,
    };
  }

  /**
   * =======================================================
   * NEW COMPANY DESTINATION
   * =======================================================
   *
   * Create the new rows first.
   *
   * Only remove the old rows after
   * the new destination succeeds.
   */

  /**
   * 1. Create new rows.
   */

  for (const row of rows) {
    const result = await googleSheetService.upsertReservation({
      technician: newTechnician,

      sheetTab: newSheetTab,

      row,
    });

    results.push({
      action: "created_in_new_sheet",

      reservationVehicleId: row.reservationVehicleId,

      result,
    });
  }

  /**
   * 2. Remove old rows.
   */

  if (previousTechnician && previousSheetTab) {
    for (const row of rows) {
      const result = await googleSheetService.removeReservationVehicle({
        technician: previousTechnician,

        sheetTab: previousSheetTab,

        reservationVehicleId: row.reservationVehicleId,
      });

      results.push({
        action: "removed_from_old_sheet",

        reservationVehicleId: row.reservationVehicleId,

        result,
      });
    }
  }

  return {
    moved: true,

    previousTechnician,

    previousSheetTab,

    newTechnician,

    newSheetTab,

    results,
  };
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  syncReservationToGoogleSheet,
  removeVehicleFromGoogleSheet,
  syncReservationAvailabilityChange,
  syncResidentialReservationToGoogleSheet,
};
