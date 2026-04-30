function registerDisplayRoutes(app, ctx) {
  const { sanitizeDisplayConfig, persistDisplayConfig, broadcast, structuredError, validateDisplayConfigPayload, badRequest } = ctx;

  app.get('/api/display-config', (req, res) => res.json(ctx.getDisplayConfig()));
  app.post('/api/display-config', (req, res) => {
    try {
      const validation = validateDisplayConfigPayload(req.body || {});
      if (!validation.ok) return badRequest(res, validation.details);
      const next = sanitizeDisplayConfig({ ...ctx.getDisplayConfig(), ...(req.body || {}) });
      ctx.setDisplayConfig(next);
      persistDisplayConfig();
      broadcast();
      res.json({ ok: true, displayConfig: next });
    } catch (error) {
      console.error('Display config save failed:', error);
      structuredError(res, 500, 'Display config save failed', String((error && error.message) || error));
    }
  });
}

module.exports = { registerDisplayRoutes };
