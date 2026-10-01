/**
 * Central Google Apps Script Web App.
 *
 * There is now ONE Apps Script for all technicians.
 */
const GOOGLE_SHEET_SCRIPT_URL = process.env.GOOGLE_SHEET_SCRIPT_URL;

const GOOGLE_SHEET_SYNC_SECRET = process.env.GOOGLE_SHEET_SYNC_SECRET;

/**
 * Maps the technician stored in Supabase
 * to their Google Spreadsheet ID.
 *
 * Important:
 * The keys should correspond to the value
 * stored in company_availabilities.technician
 * after trim().toLowerCase().
 */
const technicianSpreadsheets = {
  steve: process.env.GOOGLE_SHEET_ID_STEVE,
  pam: process.env.GOOGLE_SHEET_ID_PAM,
  yves: process.env.GOOGLE_SHEET_ID_YVES,
  martin: process.env.GOOGLE_SHEET_ID_MARTIN,
  gator: process.env.GOOGLE_SHEET_ID_GATOR,
  cdpl: process.env.GOOGLE_SHEET_ID_CDPL,
  alexis: process.env.GOOGLE_SHEET_ID_ALEXIS,
  dave: process.env.GOOGLE_SHEET_ID_DAVE,
  howard: process.env.GOOGLE_SHEET_ID_HOWARD,
  kendal: process.env.GOOGLE_SHEET_ID_KENDAL,
  alexandre: process.env.GOOGLE_SHEET_ID_ALEXANDRE,
  unite1: process.env.GOOGLE_SHEET_ID_UNITE1,
  unite2: process.env.GOOGLE_SHEET_ID_UNITE2,
  unite3: process.env.GOOGLE_SHEET_ID_UNITE3,
  unite_quebec: process.env.GOOGLE_SHEET_ID_UNITE_QUEBEC,
  max_cere: process.env.GOOGLE_SHEET_ID_MAX_CERE,
  jake: process.env.GOOGLE_SHEET_ID_JAKE,
  sasha: process.env.GOOGLE_SHEET_ID_SASHA,
};

/**
 * Normalizes the technician name used
 * as the configuration key.
 */
function normalizeTechnician(technician) {
  if (!technician) {
    return null;
  }

  return technician.trim().toLowerCase();
}

/**
 * Returns the Google Spreadsheet ID
 * assigned to a technician.
 */
function getGoogleSpreadsheetId(technician) {
  const key = normalizeTechnician(technician);

  if (!key) {
    return null;
  }

  return technicianSpreadsheets[key] || null;
}

/**
 * Returns the central Apps Script URL.
 */
function getGoogleSheetScriptUrl() {
  return GOOGLE_SHEET_SCRIPT_URL || null;
}

/**
 * Returns the secret shared between
 * Node and the central Apps Script.
 */
function getGoogleSheetSyncSecret() {
  return GOOGLE_SHEET_SYNC_SECRET || null;
}

module.exports = {
  getGoogleSpreadsheetId,
  getGoogleSheetScriptUrl,
  getGoogleSheetSyncSecret,
};
