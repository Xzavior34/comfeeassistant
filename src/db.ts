import { PrismaClient } from '@prisma/client';

let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl && dbUrl.includes('6543') && !dbUrl.includes('pgbouncer=true')) {
  dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&connection_limit=3&pool_timeout=10';
} else if (dbUrl && !dbUrl.includes('connection_limit')) {
  dbUrl += (dbUrl.includes('?') ? '&' : '?') + 'connection_limit=3&pool_timeout=10';
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});
