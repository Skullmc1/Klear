/**
 * Klear REST API server entry point.
 */
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = createApp();

const server = app.listen(PORT, HOST, () => {
  console.log(`[klear:server] API listening on http://${HOST}:${PORT}`);
  console.log(`[klear:server] POST /api/vectorize  (multipart field: image)`);
});

function shutdown(signal: string): void {
  console.log(`[klear:server] ${signal} received, shutting down…`);
  server.close(() => process.exit(0));
  // force-exit if connections don't drain quickly
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
