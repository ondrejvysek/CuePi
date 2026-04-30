function registerRundownRoutes(app, ctx) {
  const { queue, timer, requireAdmin, structuredError, parseIntField, persistRundown, persistState, broadcast, applySegmentToTimer, appendActualsLog, actualsLogFile, fs } = ctx;

  app.get('/api/rundown', (req, res) => res.json(queue.getState()));
  app.post('/api/rundown/next', requireAdmin, (req, res) => {
    const current = queue.getCurrent();
    if (current) {
      const actual = current.mode === 'countdown' ? Math.max(0, (current.duration || 0) - Math.max(0, timer.getRemainingSeconds())) : Math.max(0, timer.getRemainingSeconds());
      appendActualsLog(current.name, current.duration || 0, actual);
    }
    const nextSegment = queue.next();
    if (!nextSegment) return structuredError(res, 400, 'No rundown loaded');
    timer.state.currentIndex = queue.currentIndex;
    applySegmentToTimer(nextSegment, true);
    persistRundown(); persistState(); broadcast();
    return res.json({ ok: true, currentSegment: nextSegment, currentIndex: queue.currentIndex });
  });

  app.get('/api/rundown/actuals/export', requireAdmin, (req, res) => {
    if (!fs.existsSync(actualsLogFile)) return structuredError(res, 404, 'No actuals log available');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="actuals.csv"');
    return fs.createReadStream(actualsLogFile).pipe(res);
  });
}
module.exports = { registerRundownRoutes };
