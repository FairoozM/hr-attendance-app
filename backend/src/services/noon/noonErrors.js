class NoonServiceError extends Error {
  constructor(code, message, httpStatus = 500, details = [], meta = {}) {
    super(message)
    this.name = 'NoonServiceError'
    this.code = code
    this.httpStatus = httpStatus
    this.details = Array.isArray(details) ? details : []
    this.meta = meta && typeof meta === 'object' ? meta : {}
  }
}

function isNoonServiceError(error) {
  return error instanceof NoonServiceError
}

function toNoonErrorPayload(error) {
  if (isNoonServiceError(error)) {
    return {
      ok: false,
      code: error.code,
      error: error.message,
      ...(error.details.length ? { details: error.details } : {}),
      ...(error.meta && Object.keys(error.meta).length ? error.meta : {}),
    }
  }

  return {
    ok: false,
    code: 'NOON_UNKNOWN_ERROR',
    error: 'Noon request failed.',
  }
}

module.exports = {
  NoonServiceError,
  isNoonServiceError,
  toNoonErrorPayload,
}
