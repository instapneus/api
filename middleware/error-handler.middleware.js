// middleware/error-handler.middleware.js

const logger = require("../services/logger/logger.service");

function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err.status) ? err.status : 500;

  const code = err.code || "INTERNAL_ERROR";

  const context = {
    method: req.method,
    route: req.originalUrl,
    status,
    code,
    params: req.params,
    query: req.query,
    meta: err.meta,
  };

  /*
   * Expected 4xx application errors generally do not need
   * to become Sentry issues.
   */
  if (status >= 500) {
    logger.error(err.message || "Unexpected API error", {
      event: "API_REQUEST_FAILED",
      category: "api",
      error: err,
      context,
    });
  } else {
    logger.warn(err.message || "API request rejected", {
      event: "API_REQUEST_REJECTED",
      category: "api",
      error: err,
      context,
    });
  }

  res.status(status).json({
    success: false,
    message:
      status >= 500 && process.env.NODE_ENV === "production"
        ? "An unexpected error occurred."
        : err.message,
    code,
    meta:
      status < 500 || process.env.NODE_ENV !== "production"
        ? err.meta ?? undefined
        : undefined,
  });
}

module.exports = errorHandler;
