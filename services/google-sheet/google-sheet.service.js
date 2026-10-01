const {
  getGoogleSpreadsheetId,
  getGoogleSheetScriptUrl,
  getGoogleSheetSyncSecret,
} = require("./../../config/google-sheet.config");

const AppError = require("../../errors/app-error");

/**
 * =========================================================
 * GOOGLE SHEET CONFIGURATION
 * =========================================================
 *
 * COMPANY:
 *
 * technician
 *   ↓
 * getGoogleSpreadsheetId(technician)
 *
 *
 * RESIDENTIAL:
 *
 * spreadsheetId is supplied directly.
 *
 *
 * Both use the same:
 *
 * - Central Apps Script
 * - Shared sync secret
 */

function getGoogleSheetConfiguration({
  technician = null,
  spreadsheetId = null,
  sheetTab,
}) {
  const scriptUrl = getGoogleSheetScriptUrl();

  const syncSecret = getGoogleSheetSyncSecret();

  /**
   * =======================================================
   * CENTRAL APPS SCRIPT
   * =======================================================
   */

  if (!scriptUrl) {
    throw new AppError("Central Google Sheet script not configured", {
      status: 500,

      code: "GOOGLE_SHEET_SCRIPT_NOT_CONFIGURED",

      meta: {
        technician,
        spreadsheetId,
        sheetTab,
      },
    });
  }

  /**
   * =======================================================
   * SHARED SECRET
   * =======================================================
   */

  if (!syncSecret) {
    throw new AppError("Google Sheet sync secret not configured", {
      status: 500,

      code: "GOOGLE_SHEET_SYNC_SECRET_NOT_CONFIGURED",

      meta: {
        technician,
        spreadsheetId,
        sheetTab,
      },
    });
  }

  /**
   * =======================================================
   * RESOLVE SPREADSHEET
   * =======================================================
   *
   * Residential supplies spreadsheetId directly.
   *
   * Company supplies technician and uses the existing
   * environment/config mapping.
   */

  const resolvedSpreadsheetId =
    spreadsheetId || (technician ? getGoogleSpreadsheetId(technician) : null);

  if (!resolvedSpreadsheetId) {
    throw new AppError("Google Spreadsheet not configured", {
      status: 500,

      code: "GOOGLE_SPREADSHEET_NOT_CONFIGURED",

      meta: {
        technician,
        spreadsheetId,
        sheetTab,
      },
    });
  }

  /**
   * =======================================================
   * SHEET TAB
   * =======================================================
   */

  if (!sheetTab) {
    throw new AppError("Google Sheet tab is required", {
      status: 500,

      code: "GOOGLE_SHEET_TAB_REQUIRED",

      meta: {
        technician,
        spreadsheetId: resolvedSpreadsheetId,
      },
    });
  }

  return {
    scriptUrl,

    syncSecret,

    spreadsheetId: resolvedSpreadsheetId,
  };
}

/**
 * =========================================================
 * SEND GOOGLE SHEET REQUEST
 * =========================================================
 *
 * All Node → Apps Script operations
 * pass through this function.
 */

async function sendGoogleSheetRequest({
  technician = null,

  spreadsheetId = null,

  sheetTab,

  payload,
}) {
  const configuration = getGoogleSheetConfiguration({
    technician,

    spreadsheetId,

    sheetTab,
  });

  const {
    scriptUrl,
    syncSecret,
    spreadsheetId: resolvedSpreadsheetId,
  } = configuration;

  /**
   * Apps Script receives:
   *
   * {
   *   secret,
   *   spreadsheetId,
   *   sheetTab,
   *   action,
   *   ...
   * }
   */

  const response = await fetch(scriptUrl, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      secret: syncSecret,

      spreadsheetId: resolvedSpreadsheetId,

      sheetTab,

      ...payload,
    }),
  });

  const text = await response.text();

  /**
   * =======================================================
   * HTTP FAILURE
   * =======================================================
   */

  if (!response.ok) {
    throw new AppError("Google Sheet request failed", {
      status: 502,

      code: "GOOGLE_SHEET_REQUEST_FAILED",

      meta: {
        technician,

        sheetTab,

        spreadsheetId: resolvedSpreadsheetId,

        responseStatus: response.status,

        response: text,
      },
    });
  }

  let result;

  /**
   * =======================================================
   * APPS SCRIPT RESPONSE
   * =======================================================
   */

  try {
    result = JSON.parse(text);
  } catch {
    /**
     * Apps Script should normally return JSON.
     *
     * Keep unexpected responses available without
     * breaking successful HTTP requests.
     */
    result = {
      success: true,

      raw: text,
    };
  }

  /**
   * =======================================================
   * APPLICATION FAILURE
   * =======================================================
   */

  if (result?.success === false) {
    throw new AppError("Google Sheet synchronization failed", {
      status: 502,

      code: "GOOGLE_SHEET_SYNC_FAILED",

      meta: {
        technician,

        sheetTab,

        spreadsheetId: resolvedSpreadsheetId,

        response: result,
      },
    });
  }

  return result;
}

/**
 * =========================================================
 * COMPANY — UPSERT VEHICLE ROW
 * =========================================================
 */

async function upsertReservation({ technician, sheetTab, row }) {
  return sendGoogleSheetRequest({
    technician,

    sheetTab,

    payload: {
      action: "upsert",

      row,
    },
  });
}

/**
 * =========================================================
 * COMPANY — REMOVE VEHICLE ROW
 * =========================================================
 */

async function removeReservationVehicle({
  technician,
  sheetTab,
  reservationVehicleId,
}) {
  if (!reservationVehicleId) {
    throw new AppError("Reservation vehicle ID is required", {
      status: 500,

      code: "GOOGLE_SHEET_VEHICLE_ID_REQUIRED",

      meta: {
        technician,
        sheetTab,
      },
    });
  }

  return sendGoogleSheetRequest({
    technician,

    sheetTab,

    payload: {
      action: "remove",

      reservationVehicleId,
    },
  });
}

/**
 * =========================================================
 * RESIDENTIAL — UPSERT RESERVATION ROW
 * =========================================================
 *
 * Residential uses:
 *
 * ONE Google Sheet row per reservation.
 *
 * The Spreadsheet ID is supplied directly instead
 * of being resolved from a technician.
 */

async function upsertResidentialReservation({ spreadsheetId, sheetTab, row }) {
  if (!row?.reservationId) {
    throw new AppError("Residential reservation ID is required", {
      status: 500,

      code: "GOOGLE_SHEET_RESIDENTIAL_RESERVATION_ID_REQUIRED",

      meta: {
        spreadsheetId,
        sheetTab,
      },
    });
  }

  return sendGoogleSheetRequest({
    spreadsheetId,

    sheetTab,

    payload: {
      action: "upsertResidential",

      row,
    },
  });
}

/**
 * =========================================================
 * TIRE ESTIMATE — UPSERT REQUEST ROW
 * =========================================================
 */

async function upsertTireEstimate({ spreadsheetId, sheetTab, row }) {
  if (!row?.tirePurchaseRequestId) {
    throw new AppError("Tire purchase request ID is required", {
      status: 500,

      code: "GOOGLE_SHEET_TIRE_REQUEST_ID_REQUIRED",

      meta: {
        spreadsheetId,
        sheetTab,
      },
    });
  }

  return sendGoogleSheetRequest({
    spreadsheetId,

    sheetTab,

    payload: {
      action: "upsertTireEstimate",

      row,
    },
  });
}

/**
 * =========================================================
 * EXPORTS
 * =========================================================
 */

module.exports = {
  upsertReservation,
  removeReservationVehicle,
  upsertResidentialReservation,
  upsertTireEstimate,
};
