import type { Server } from 'node:http';
import app from './app.js';
import config from './config/index.js';
import { prisma } from './utils/prisma.js';
import { connectRedis, redisClient } from './utils/redis.js';

let server: Server;

async function main() {
  try {
    await prisma.$connect();
    console.log('Connected to the database successfully.');

    await connectRedis();
    console.log('Connected to Redis successfully.');

    server = app.listen(config.port, () => {
      console.log(`Server is running on port ${config.port}`);
    });
  } catch (error) {
    console.error('Failed to start the server:', error);
    process.exit(1);
  }
}

main();

const shutdown = async (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server?.close(async () => {
    await prisma.$disconnect();
    if (redisClient.isOpen) await redisClient.disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  server?.close(() => process.exit(1));
});
