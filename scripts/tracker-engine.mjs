#!/usr/bin/env node

import http from 'node:http';

const port = Number(process.env.TRACKER_ENGINE_PORT ?? 8091);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'tracker-engine', ts: new Date().toISOString() }));
    return;
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  // Keep output concise to avoid terminal noise in dev mode.
  console.log(`[tracker-engine] running on http://localhost:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
