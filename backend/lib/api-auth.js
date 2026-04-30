function structuredError(res, code, message, details = null) {
  return res.status(code).json({ error: message, details });
}
function createRequireAdmin(adminToken) {
  return (req, res, next) => {
    if (!adminToken) return next();
    const token = req.header('x-stage-timer-token');
    if (!token) return structuredError(res, 401, 'Missing admin token');
    if (token !== adminToken) return structuredError(res, 403, 'Invalid admin token');
    return next();
  };
}
function createLegacyRoute(app, { strictV2Only, requireAdmin }) {
  return (pathName, handler, options = {}) => app.get(pathName, (req, res, next) => {
    if (strictV2Only) return res.status(410).json({ error: 'Legacy GET routes are disabled in v2-only mode' });
    res.setHeader('Warning', '299 - Deprecated GET; use POST variant');
    if (options.auth) return requireAdmin(req, res, () => handler(req, res, next));
    return handler(req, res, next);
  });
}
module.exports = { structuredError, createRequireAdmin, createLegacyRoute };
