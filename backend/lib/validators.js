function createValidationError(error, details = []) {
  return { error, details: Array.isArray(details) ? details : [details] };
}

function badRequest(res, details) {
  return res.status(400).json(createValidationError('Invalid payload', details));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function requiredField(obj, key) {
  if (!obj || obj[key] === undefined || obj[key] === null) return { ok: false, error: `${key} is required` };
  return { ok: true, value: obj[key] };
}

function stringField(value, key, opts = {}) {
  if (typeof value !== 'string') return { ok: false, error: `${key} must be a string` };
  const trimmed = opts.trim ? value.trim() : value;
  if (opts.min != null && trimmed.length < opts.min) return { ok: false, error: `${key} length must be >= ${opts.min}` };
  if (opts.max != null && trimmed.length > opts.max) return { ok: false, error: `${key} length must be <= ${opts.max}` };
  return { ok: true, value: trimmed };
}

function numberField(value, key, opts = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return { ok: false, error: `${key} must be a number` };
  const parsed = opts.integer ? Math.floor(num) : num;
  if (opts.min != null && parsed < opts.min) return { ok: false, error: `${key} must be >= ${opts.min}` };
  if (opts.max != null && parsed > opts.max) return { ok: false, error: `${key} must be <= ${opts.max}` };
  return { ok: true, value: parsed };
}

function enumField(value, key, allowed) {
  if (!allowed.includes(value)) return { ok: false, error: `${key} must be one of: ${allowed.join(', ')}` };
  return { ok: true, value };
}

function isAcceptedColorFormat(value) {
  if (typeof value !== 'string') return false;
  const color = value.trim();
  if (!color) return false;
  const hexRe = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgbRe = /^rgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
  const hslRe = /^hsla?\(\s*-?\d{1,3}(?:\.\d+)?(?:deg|rad|turn)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i;
  return hexRe.test(color) || rgbRe.test(color) || hslRe.test(color);
}

module.exports = {
  asObject,
  badRequest,
  createValidationError,
  enumField,
  isAcceptedColorFormat,
  numberField,
  requiredField,
  stringField,
};
