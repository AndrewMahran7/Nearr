// Inert containment replacement. Never imports old worker/provider/DB modules.
const http = require('node:http');
const version = 'nearr-production-pause-v1';
function createServer() {
  return http.createServer((req, res) => {
    const healthy = req.method === 'GET' && req.url === '/health';
    const body = healthy ? { status: 'ok', recognition: 'paused', containmentVersion: version }
      : { status: 'not_ready', error: 'recognition_temporarily_unavailable', paused: true,
          configured: false, providerDispatchEnabled: false, containmentVersion: version };
    res.writeHead(healthy ? 200 : 503, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      ...(healthy ? {} : { 'Retry-After': '3600' }),
    });
    // Do not read, log, buffer or dispatch the request body (even authenticated).
    req.resume();
    res.end(JSON.stringify(body));
  });
}
module.exports = { createServer };
if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');
  const server = createServer();
  server.listen(port, '0.0.0.0');
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
