// Learn more https://docs.expo.dev/guides/customizing-metro
const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// FIREFIRST_API_PROXY=http://127.0.0.1:8000 makes the dev server forward API calls to the
// backend, so a phone only needs to reach Metro's port (trial.py sets this up).
const proxyTarget = process.env.FIREFIRST_API_PROXY;
if (proxyTarget) {
  const { hostname, port } = new URL(proxyTarget);
  const enhance = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (metroMiddleware, server) => {
    const metro = enhance ? enhance(metroMiddleware, server) : metroMiddleware;
    return (req, res, next) => {
      if (!/^\/(api\/|healthz)/.test(req.url)) return metro(req, res, next);
      // Keep the Host header: links the backend builds should point back through this proxy.
      const upstream = http.request(
        { hostname, port, path: req.url, method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', (error) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: `The FireFirst server isn't running (${error.message}).` }));
      });
      req.pipe(upstream);
    };
  };
}

module.exports = config;
