const http = require("http");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The shared design tokens and formatting helpers live in ../packages and are
// linked into node_modules; Metro has to watch them to see edits.
config.watchFolders = [path.resolve(__dirname, "../packages")];
// Their imports resolve from this app's node_modules — the repo root's belong to
// the web app, on a different React.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

// Development only: the browser preview calls /api on its own origin and this
// forwards it to the backend, so the preview needs no CORS exception. The
// phone and the emulator call the backend directly (src/lib/config.ts).
const BACKEND = { host: "127.0.0.1", port: Number(process.env.AUTOSAARTHI_BACKEND_PORT || 8010) };

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (!req.url || !req.url.startsWith("/api/")) return middleware(req, res, next);
    const upstream = http.request(
      { ...BACKEND, path: req.url, method: req.method, headers: { ...req.headers, host: `${BACKEND.host}:${BACKEND.port}` } },
      (reply) => {
        res.writeHead(reply.statusCode || 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "the backend is not running" }));
    });
    req.pipe(upstream);
  },
};

module.exports = config;
