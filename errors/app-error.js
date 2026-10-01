// errors/app-error.js

class AppError extends Error {
  constructor(message, { status = 500, code = null, meta = null } = {}) {
    super(message);

    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.meta = meta;

    Error.captureStackTrace?.(this, AppError);
  }
}

module.exports = AppError;
