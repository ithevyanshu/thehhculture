/**
 * Give every artist without a @handle one: their Instagram username if known,
 * otherwise stage_name. Safe to re-run; never touches existing handles.
 *   npm run handles:backfill
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { autoHandle, uniqueHandle } from '../src/lib/handles';

(async () => {
  const artists = await prisma.artist.findMany({
    where: { handle: null },
    select: { id: true, name: true, instagramUrl: true },
    orderBy: { createdAt: 'asc' }, // older artists win ties for a handle
  });
  for (const a of artists) {
    const handle = await uniqueHandle(autoHandle(a), a.id);
    await prisma.artist.update({ where: { id: a.id }, data: { handle } });
    console.log(`  ${a.name.padEnd(20)} @${handle}${a.instagramUrl ? '  (from Instagram)' : ''}`);
  }
  console.log(`Done: ${artists.length} handle(s) assigned.`);
  await prisma.$disconnect();
})();
