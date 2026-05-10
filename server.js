const { createCuePiServer } = require('./backend/app');

const cuepi = createCuePiServer({
  bindHost: process.env.BIND_HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  shell: process.env.CUEPI_SHELL || 'web',
  role: process.env.CUEPI_ROLE || 'standalone',
});

cuepi.start().then(({ url }) => {
  console.log(`CuePi running at ${url}`);
});
