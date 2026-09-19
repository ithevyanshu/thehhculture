/**
 * Fill missing artist Instagram links from Wikidata.
 *   npm run socials:fetch            # only artists without a link
 *   npm run socials:fetch -- --force # re-check every artist
 */
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { backfillInstagram } from '../src/modules/images/backfill';

(async () => {
  const overwrite = process.argv.includes('--force');
  console.log(`Looking up Instagram handles on Wikidata${overwrite ? ' (overwriting existing)' : ''}...`);
  const results = await backfillInstagram({ overwrite });
  for (const r of results) {
    const detail = r.status === 'updated' ? `-> @${r.handle}` : r.status === 'error' ? `(${r.error})` : r.pageTitle ? '(no handle on Wikidata)' : '(no Wikipedia match)';
    console.log(`  ${r.status.padEnd(9)} ${r.artist} ${detail}`);
  }
  console.log(`Done: ${results.filter((r) => r.status === 'updated').length}/${results.length} updated.`);
  await prisma.$disconnect();
})();
