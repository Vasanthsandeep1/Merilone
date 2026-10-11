// Shared by both apps' metro.config.js: the Expo dev server also forwards
// /api/... and /uploads/... to the B2G backend on this computer (port 5012).
// So the app only ever talks to the address it was opened from — the Wi-Fi
// address, or the public tunnel link (`npx expo start --tunnel`) when the
// phone can't reach the computer directly. One link serves app + backend.
const http = require('http');

const BACKEND = { host: '127.0.0.1', port: Number(process.env.M1_BACKEND_PORT || 5012) };

function withBackendProxy(config) {
  const previous = config.server && config.server.enhanceMiddleware;
  config.server = {
    ...(config.server || {}),
    enhanceMiddleware: (middleware, server) => {
      const base = previous ? previous(middleware, server) : middleware;
      return (req, res, next) => {
        if (!req.url || !(req.url.startsWith('/api/') || req.url.startsWith('/uploads/'))) return base(req, res, next);
        const upstream = http.request(
          { ...BACKEND, path: req.url, method: req.method, headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` } },
          (r) => { res.writeHead(r.statusCode || 502, r.headers); r.pipe(res); },
        );
        upstream.on('error', () => {
          if (res.headersSent) return res.end();
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, message: `The backend isn't running on this computer (port ${BACKEND.port}). Start it with npm run dev.` }));
        });
        req.pipe(upstream);
        return undefined;
      };
    },
  };
  return config;
}

module.exports = { withBackendProxy };
