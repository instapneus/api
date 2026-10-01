// instrument.js
require("dotenv").config();

const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  environment: process.env.NODE_ENV || "development",

  enabled: Boolean(process.env.SENTRY_DSN),

  /*
   * Start with error monitoring only.
   * We can add performance tracing later.
   */
  tracesSampleRate: 0,

  /*
   * Avoid automatically sending personal information.
   * We can add safe user identifiers manually later.
   */
  sendDefaultPii: false,
});

module.exports = Sentry;
