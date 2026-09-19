import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`DHH API listening on http://localhost:${env.PORT}/api/v1`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
