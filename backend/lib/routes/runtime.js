function registerRuntimeRoutes(app, ctx) {
  const { runtimeContext } = ctx;
  app.get('/api/runtime', (req, res) => res.json(runtimeContext()));
}
module.exports = { registerRuntimeRoutes };
