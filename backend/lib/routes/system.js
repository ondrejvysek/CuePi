function registerSystemRoutes(app, ctx) {
  const { requireAdmin, structuredError, hardware } = ctx;

  app.post('/api/system/restart', requireAdmin, (req, res) => {
    res.json({ ok: true, status: 'Restarting system service' });
    hardware.restartService();
  });

  app.post('/api/system/update', requireAdmin, (req, res) => {
    res.json({ ok: true, status: 'Pulling firmware and system updates' });
    hardware.updateSystem();
  });

  app.post('/api/system/hostname', requireAdmin, (req, res) => {
    const name = req.body && req.body.name;
    if (!name || typeof name !== 'string' || !/^[a-zA-Z0-9-]{1,63}$/.test(name)) return structuredError(res, 400, 'Invalid payload', 'name must be 1-63 chars [a-zA-Z0-9-]');
    hardware.setHostname(name, (error) => {
      if (error) return structuredError(res, 500, 'Failed to update hostname');
      return res.json({ ok: true, status: 'Hostname updated' });
    });
  });
}
module.exports = { registerSystemRoutes };
