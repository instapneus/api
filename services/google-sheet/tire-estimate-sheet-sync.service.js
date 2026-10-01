const supabase = require("../../config/supabase");
const notificationService = require("../notification.service");
const googleSheetService = require("./google-sheet.service");

/**
 * =========================================================
 * TIRE REQUEST GOOGLE SHEET
 * =========================================================
 *
 * Despite the filename, this sync handles:
 *
 * - Standalone tire estimates
 * - Company tire requests
 * - Residential tire requests
 */

const TIRE_ESTIMATE_SPREADSHEET_ID =
  "1iwSMitNzzfH4UOzFDELWtdA52AxY5LR_jviy2TIDhxA";

const TIRE_ESTIMATE_SHEET_TAB = "Nouveau demande de pneus";

/**
 * =========================================================
 * LABELS
 * =========================================================
 */

const TIRE_TYPE_LABELS = {
  winter: "Hiver",
  summer: "Été",
  all_season: "Toutes saisons",
};

const TIRE_CONDITION_LABELS = {
  used: "Usagé",
  new: "Neuf",
  both: "Neuf ou usagé",
};

/**
 * =========================================================
 * FORMAT VEHICLE
 * =========================================================
 *
 * Acura TSX 2021
 */

function formatVehicle(vehicle) {
  if (!vehicle) {
    return "";
  }

  return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ");
}

/**
 * =========================================================
 * FORMAT TIRE REQUEST
 * =========================================================
 *
 * 275/25/R21 — Hiver — Usagé
 */

function formatTireRequest(vehicle) {
  if (!vehicle) {
    return "";
  }

  const values = [];

  if (vehicle.width && vehicle.profile && vehicle.diameter) {
    values.push(`${vehicle.width}/${vehicle.profile}/${vehicle.diameter}`);
  }

  if (vehicle.tire_type) {
    values.push(TIRE_TYPE_LABELS[vehicle.tire_type] || vehicle.tire_type);
  }

  if (vehicle.tire_condition) {
    values.push(
      TIRE_CONDITION_LABELS[vehicle.tire_condition] || vehicle.tire_condition
    );
  }

  return values.join(" — ");
}

/**
 * =========================================================
 * FORMAT LOCATION
 * =========================================================
 */

function formatLocation(data) {
  /**
   * COMPANY
   *
   * Example:
   *
   * Valnet — Bureau Montréal
   */
  if (data.company || data.location) {
    return [data.company?.name, data.location?.name]
      .filter(Boolean)
      .join(" — ");
  }

  /**
   * RESIDENTIAL
   *
   * Try to display only the city.
   */
  const homeAddress = data.reservation?.home_address;

  if (homeAddress) {
    /**
     * JSON/object address.
     */
    if (typeof homeAddress === "object" && homeAddress.city) {
      return homeAddress.city;
    }

    /**
     * Sometimes Supabase may return JSON
     * as a string.
     */
    if (typeof homeAddress === "string") {
      try {
        const parsed = JSON.parse(homeAddress);

        if (parsed?.city) {
          return parsed.city;
        }
      } catch {
        // Not JSON. Continue below.
      }
    }
  }

  /**
   * STANDALONE
   *
   * Existing values:
   *
   * Domicile / Laval
   * Entreprise / w21
   *
   * We only want the useful part.
   */
  if (data.service_location) {
    const value = String(data.service_location).trim();

    const separatorIndex = value.indexOf("/");

    if (separatorIndex !== -1) {
      return value.substring(separatorIndex + 1).trim();
    }

    return value;
  }

  return "";
}

/**
 * =========================================================
 * FETCH TIRE REQUEST
 * =========================================================
 *
 * Can find a request using:
 *
 * Standalone:
 *   tirePurchaseRequestId
 *
 * Company / Residential:
 *   reservationId
 */

async function getTireRequestForGoogleSheet({
  tirePurchaseRequestId = null,
  reservationId = null,
}) {
  let query = supabase.from("tire_purchase_requests").select(
    `
        id,
        reservation_id,
        source,
        status,
        service_location,
        notes,
        created_at,

        customer:customers(
          id,
          first_name,
          last_name,
          email,
          phone
        ),

        company:companies(
          id,
          name
        ),

        location:company_locations(
          id,
          name
        ),

        reservation:reservations(
          id,
          home_address
        ),

        vehicles:tire_purchase_request_vehicles(
          id,
          year,
          brand,
          model,
          tire_type,
          tire_condition,
          width,
          profile,
          diameter
        )
      `
  );

  /**
   * Standalone tire estimate.
   */
  if (tirePurchaseRequestId) {
    query = query.eq("id", tirePurchaseRequestId);
  } else if (reservationId) {
    /**
     * Company / residential reservation.
     */
    query = query.eq("reservation_id", reservationId);
  } else {
    /**
     * Nothing supplied.
     */
    throw new Error("Tire purchase request ID or reservation ID is required");
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * =========================================================
 * SYNC TIRE REQUEST TO GOOGLE SHEET
 * =========================================================
 */

async function syncTireEstimateToGoogleSheet({
  tirePurchaseRequestId = null,
  reservationId = null,
}) {
  /**
   * Always fetch fresh data from Supabase.
   */
  const data = await getTireRequestForGoogleSheet({
    tirePurchaseRequestId,
    reservationId,
  });

  /**
   * Company/residential reservations may not
   * contain a tire purchase request.
   *
   * That is perfectly normal.
   */
  if (!data) {
    return {
      success: true,
      skipped: true,
      reason: "NO_TIRE_REQUEST",
    };
  }

  const vehicles = data.vehicles || [];

  if (!vehicles.length) {
    return {
      success: true,
      skipped: true,
      reason: "NO_TIRE_REQUEST_VEHICLES",
    };
  }

  /**
   * =======================================================
   * VEHICLES
   * =======================================================
   *
   * One tire request = one Google Sheet row.
   *
   * If there are multiple vehicles:
   *
   * Acura TSX 2021
   * Honda Civic 2020
   */

  const vehicleLabel = vehicles.map(formatVehicle).filter(Boolean).join("\n");

  /**
   * =======================================================
   * REQUEST
   * =======================================================
   *
   * 275/25/R21 — Hiver — Usagé
   * 225/45/R17 — Toutes saisons — Neuf
   */

  const requestLabel = vehicles
    .map(formatTireRequest)
    .filter(Boolean)
    .join("\n");

  /**
   * =======================================================
   * GOOGLE SHEET ROW
   * =======================================================
   */

  const row = {
    tirePurchaseRequestId: data.id,
    requestDate: data.created_at,
    name: [data.customer?.first_name, data.customer?.last_name]
      .filter(Boolean)
      .join(" "),
    email: data.customer?.email || "",
    phone: data.customer?.phone || "",
    location: formatLocation(data),
    vehicle: vehicleLabel,
    request: requestLabel,
    notes: data.notes || "",
    lastSyncedAt: new Date().toISOString(),
  };

  const sheetResult = await googleSheetService.upsertTireEstimate({
    spreadsheetId: TIRE_ESTIMATE_SPREADSHEET_ID,
    sheetTab: TIRE_ESTIMATE_SHEET_TAB,
    row,
  });

  /**
   * Only notify Joe when Apps Script actually APPENDED
   * a brand-new tire request.
   *
   * Re-syncing/updating an existing row does not send
   * another email.
   */
  if (
    sheetResult?.success === true &&
    sheetResult?.action === "tire_estimate_created"
  ) {
    const sheetUrl =
      `https://docs.google.com/spreadsheets/d/` +
      `${TIRE_ESTIMATE_SPREADSHEET_ID}/edit`;

    const notification =
      await notificationService.sendNewTireRequestNotification({
        tirePurchaseRequestId: data.id,
        source: data.source,
        requestDate: row.requestDate,
        name: row.name,
        phone: row.phone,
        email: row.email,
        vehicle: row.vehicle,
        location: row.location,
        request: row.request,
        notes: row.notes,
        sheetUrl,
      });

    if (!notification.sent) {
      console.error("New tire request email was not sent:", {
        tirePurchaseRequestId: data.id,
        notification,
      });
    }
  }

  return sheetResult;
}

module.exports = {
  syncTireEstimateToGoogleSheet,
};
