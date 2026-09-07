import { PrismaPg } from '@prisma/adapter-pg';
import config from '../config/index.js';
import { PrismaClient } from '../../generated/prisma/client.js';

// Prisma 7 talks to Postgres through a driver adapter rather than its own
// bundled query engine, so the connection string is supplied here instead of
// coming from the schema. This is the pooled URL — migrations use DIRECT_URL,
// which prisma.config.ts hands to the CLI.
const adapter = new PrismaPg({ connectionString: config.database_url });

export const prisma = new PrismaClient({ adapter });
