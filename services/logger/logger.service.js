// services/logger.service.js

const Sentry = require("@sentry/node");

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "phone",
  "email",
  "address",
]);

function sanitize(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return value.map(sanitize);
  }

  if (typeof value === "object") {
    return Object.entries(value).reduce((result, [key, item]) => {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = sanitize(item);
      }

      return result;
    }, {});
  }

  return value;
}

function writeToConsole(level, message, data = {}) {
  const payload = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...sanitize(data),
  };

  switch (level) {
    case "ERROR":
      console.error(payload);
      break;

    case "WARN":
      console.warn(payload);
      break;

    default:
      console.log(payload);
  }
}

function info(message, { event, category, context = {} } = {}) {
  writeToConsole("INFO", message, {
    event,
    category,
    context,
  });

  // Do not send routine informational logs to Sentry for now.
}

function warn(
  message,
  { event, category, error, context = {}, capture = false } = {}
) {
  writeToConsole("WARN", message, {
    event,
    category,
    error,
    context,
  });

  /*
   * By default, warnings remain console-only.
   * Set capture: true for an important non-fatal problem.
   */
  if (!capture) {
    return;
  }

  captureInSentry({
    level: "warning",
    message,
    event,
    category,
    error,
    context,
  });
}

function error(message, { event, category, error, context = {} } = {}) {
  writeToConsole("ERROR", message, {
    event,
    category,
    error,
    context,
  });

  captureInSentry({
    level: "error",
    message,
    event,
    category,
    error,
    context,
  });
}

function captureInSentry({ level, message, event, category, error, context }) {
  Sentry.withScope((scope) => {
    scope.setLevel(level);

    if (event) {
      scope.setTag("event", event);
    }

    if (category) {
      scope.setTag("category", category);
    }

    if (context && Object.keys(context).length > 0) {
      scope.setContext("application", sanitize(context));
    }

    if (error instanceof Error) {
      if (error.code) {
        scope.setTag("error_code", String(error.code));
      }

      if (error.status) {
        scope.setTag("http_status", String(error.status));
      }

      Sentry.captureException(error);
      return;
    }

    Sentry.captureMessage(message, level);
  });
}

module.exports = {
  info,
  warn,
  error,
};
