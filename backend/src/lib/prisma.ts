import { PrismaClient } from '@prisma/client';

const base = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * After a migration changes a column's type, pooled Postgres sessions can still hold
 * query plans for the old shape and answer "cached plan must not change result type"
 * until they're recycled. Dropping the connections and retrying once clears it, so a
 * deploy doesn't throw 500s at people for the first few minutes.
 */
const STALE_PLAN = 'cached plan must not change result type';

export const prisma = base.$extends({
  query: {
    async $allOperations({ args, query }) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await query(args);
        } catch (err) {
          // The pooler hands out a different session each time, so retrying finds a clean one.
          if (attempt >= 4 || !(err instanceof Error) || !err.message.includes(STALE_PLAN)) throw err;
          await base.$disconnect();
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    },
  },
}) as unknown as PrismaClient;
