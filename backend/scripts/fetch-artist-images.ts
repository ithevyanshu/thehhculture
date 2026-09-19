/**
 * Fill missing artist photos from Wikipedia / Wikimedia Commons.
 *   npm run images:fetch            # only artists without an image
 *   npm run images:fetch -- --force # re-fetch for every artist
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { backfillArtistImages } from '../src/modules/images/backfill';

(async () => {
  const overwrite = process.argv.includes('--force');
  console.log(`Fetching artist images from Wikipedia${overwrite ? ' (overwriting existing)' : ''}...`);
  const results = await backfillArtistImages({ overwrite });
  for (const r of results) {
    const detail = r.status === 'updated' ? `-> ${r.pageTitle}` : r.status === 'error' ? `(${r.error})` : '';
    console.log(`  ${r.status.padEnd(9)} ${r.artist} ${detail}`);
  }
  const updated = results.filter((r) => r.status === 'updated').length;
  console.log(`Done: ${updated}/${results.length} updated.`);
  await prisma.$disconnect();
})();
