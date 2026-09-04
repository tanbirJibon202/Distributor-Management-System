import type { Server } from 'node:http';
import app from './app.js';
import config from './app/config/index.js';
import { prisma } from './app/lib/prisma.js';
import { redisClient } from './app/lib/redis.js';
import { seedDemoData, seedSuperAdmin } from './app/utils/seed.js';

const PORT = config.port;

let server: Server;

const main = async () => {
  try {
    await prisma.$connect();
    console.log('Connected to the database successfully.');

    await redisClient.connect();
    console.log('Redis Connected Successfully.');

    await seedSuperAdmin();
    await seedDemoData();

    server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error starting the server:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

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
