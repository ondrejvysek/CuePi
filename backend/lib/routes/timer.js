function registerTimerRoutes(app, ctx) {
  const { timer, persistState, broadcast, structuredError, parseIntField, reqValue, legacyRoute, requireAdmin, quickMessages } = ctx;

  const resetInput = (req) => parseIntField(reqValue(req, 'sec') ?? timer.state.durationSeconds, 'sec', { min: 0, max: 86400 });

  app.post('/api/start', (req, res) => { timer.start(); persistState(); broadcast(); res.json({ ok: true, status: 'Started' }); });
  legacyRoute('/api/start', (req, res) => { timer.start(); persistState(); broadcast(); res.send('Started'); });
  app.post('/api/pause', (req, res) => { timer.pause(); persistState(); broadcast(); res.json({ ok: true, status: 'Paused' }); });
  legacyRoute('/api/pause', (req, res) => { timer.pause(); persistState(); broadcast(); res.send('Paused'); });
  app.post('/api/reset', requireAdmin, (req, res) => { const p = resetInput(req); if (p.error) return structuredError(res, 400, 'Invalid payload', p.error); timer.reset(p.value); persistState(); broadcast(); return res.json({ ok: true, status: 'Reset' }); });
  legacyRoute('/api/reset', (req, res) => { const p = resetInput(req); if (p.error) return res.status(400).send(p.error); timer.reset(p.value); persistState(); broadcast(); return res.send('Reset'); }, { auth: true });
  app.post('/api/message/trigger', (req, res) => {
    const parsed = parseIntField(reqValue(req, 'index'), 'index', { min: 0, max: quickMessages.length - 1 });
    if (parsed.error) return structuredError(res, 400, 'Invalid payload', parsed.error);
    timer.setMessage(quickMessages[parsed.value], 'quick_message');
    timer.state.showMessage = true;
    persistState();
    broadcast();
    return res.json({ ok: true });
  });
}
module.exports = { registerTimerRoutes };
