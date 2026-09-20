/**
 * Bulk import every artist's releases from iTunes.
 *
 *   npx tsx scripts/import-catalog.ts --dry                 # scan only: what would be imported
 *   npx tsx scripts/import-catalog.ts --apply               # import the confirmed matches
 *   npx tsx scripts/import-catalog.ts --apply --max 25      # newest 25 tracks per artist
 *   npx tsx scripts/import-catalog.ts --apply --only slug-a,slug-b
 *
 * Each artist becomes its own ImportBatch, so any single artist can be undone from
 * Admin → Import without touching the others. Nothing already in the catalog is
 * replaced: songs we hold are matched by title and skipped.
 *
 * Matching rules (a wrong match puts someone else's songs on an artist's page):
 *  - "confirmed": exact name (ignoring case, accents, $ and Δ) AND either a plausible
 *    genre or an overlap with song titles we already have.
 *  - "ask": exact name but nothing to verify it with. Listed with sample tracks so a
 *    human can decide; skipped unless --include-ask is passed.
 */
import 'dotenv/config';
import fs from 'fs';
import { prisma } from '../src/lib/prisma';
import { findCandidates, norm, preview, run } from '../src/modules/import/import.service';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i > -1 ? args[i + 1] : undefined;
};
const APPLY = flag('apply');
/**
 * Verdicts from an earlier --dry scan. After a wipe there are no songs left to verify a
 * match against, so the decisions made while the catalog was intact are reused here.
 */
const PLAN = value('plan') ? (JSON.parse(fs.readFileSync(value('plan')!, 'utf8')) as Row[]) : null;
/** Slugs the human confirmed from the "needs a human" list. */
const APPROVED = new Set((value('approve') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const MAX = Number(value('max') ?? 0); // 0 = everything iTunes lists
const ONLY = value('only')?.split(',').map((s) => s.trim());
const INCLUDE_ASK = flag('include-ask');
const JSON_OUT = value('json');

const RAP_GENRE = /hip-hop|rap|desi|punjabi|indian|world|electronic|dance|alternative|pop/i;

type Status = 'confirmed' | 'ask' | 'no-match' | 'nothing-new' | 'imported' | 'failed' | 'skipped';
interface Row {
  slug: string;
  name: string;
  ourSongs: number;
  status: Status;
  itunesId?: string;
  itunesName?: string;
  genre?: string | null;
  newTracks?: number;
  alreadyHere?: number;
  sample?: string[];
  imported?: { songs: number; albums: number; batchId: string };
  reason?: string;
}

(async () => {
  const artists = await prisma.artist.findMany({
    where: ONLY ? { slug: { in: ONLY } } : {},
    orderBy: [{ viewCount: 'desc' }, { name: 'asc' }],
    select: { id: true, slug: true, name: true, _count: { select: { songs: true } }, songs: { select: { title: true }, take: 10 } },
  });
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
  console.log(`${APPLY ? 'Importing' : 'Scanning'} ${artists.length} artists${MAX ? `, newest ${MAX} tracks each` : ''}…\n`);

  const rows: Row[] = [];
  for (const artist of artists) {
    const row: Row = { slug: artist.slug, name: artist.name, ourSongs: artist._count.songs, status: 'no-match' };
    const planned = PLAN?.find((p) => p.slug === artist.slug);
    if (PLAN && (!planned || (planned.status !== 'confirmed' && planned.status !== 'imported' && !APPROVED.has(artist.slug)))) {
      row.status = 'skipped';
      row.reason = planned ? `scan said "${planned.status}"` : 'not in the scan';
      rows.push(row);
      continue;
    }

    try {
      const { candidates } = await findCandidates(artist.id);
      const exact = candidates.filter((c) => c.exactName);
      // With a plan, stick to the artist the scan matched.
      const hit = (planned?.itunesId && candidates.find((c) => c.itunesId === planned.itunesId)) || exact.find((c) => RAP_GENRE.test(c.genre ?? '')) || exact[0];
      if (!hit) {
        rows.push(row);
        console.log(`·  ${artist.name.padEnd(24).slice(0, 24)} no match on iTunes`);
        continue;
      }
      Object.assign(row, { itunesId: hit.itunesId, itunesName: hit.name, genre: hit.genre });

      const { items } = await preview(artist.id, hit.itunesId);
      const fresh = items.filter((t) => !t.skip);
      const already = items.filter((t) => t.skip === 'already-here');
      row.newTracks = fresh.length;
      row.alreadyHere = already.length;
      row.sample = fresh.slice(0, 5).map((t) => t.title);

      // Their catalog overlapping ours is proof it's the same artist.
      const verified = PLAN ? true : already.length > 0 || (RAP_GENRE.test(hit.genre ?? '') && artist._count.songs === 0);
      row.status = verified ? 'confirmed' : 'ask';
      if (!fresh.length) row.status = 'nothing-new';

      if (APPLY && (row.status === 'confirmed' || (row.status === 'ask' && INCLUDE_ASK))) {
        const trackIds = (MAX ? fresh.slice(0, MAX) : fresh).map((t) => t.itunesTrackId);
        const batch = await run({ artistId: artist.id, itunesId: hit.itunesId, trackIds, userId: admin.id });
        row.imported = { songs: batch.songIds.length, albums: batch.albumIds.length, batchId: batch.id };
        row.status = 'imported';
      } else if (APPLY && row.status === 'ask') {
        row.status = 'skipped';
      }
    } catch (err) {
      row.status = 'failed';
      row.reason = err instanceof Error ? err.message.split('\n')[0] : 'unknown error';
    }

    rows.push(row);
    const mark = { confirmed: '✓', imported: '✓', ask: '?', 'no-match': '·', 'nothing-new': '=', failed: '!', skipped: '-' }[row.status];
    const detail = row.imported
      ? `imported ${row.imported.songs} songs, ${row.imported.albums} releases`
      : row.status === 'failed'
        ? row.reason
        : row.status === 'nothing-new'
          ? 'nothing new'
          : `${row.newTracks ?? 0} new (${row.alreadyHere ?? 0} already here)${row.status === 'ask' ? '  ← needs a human' : ''}`;
    console.log(`${mark}  ${artist.name.padEnd(24).slice(0, 24)} ${String(row.ourSongs).padStart(3)} here  ${detail}`);
  }

  const by = (s: Status) => rows.filter((r) => r.status === s);
  const totalNew = rows.reduce((n, r) => n + (r.imported?.songs ?? (r.status === 'confirmed' ? (MAX ? Math.min(MAX, r.newTracks ?? 0) : (r.newTracks ?? 0)) : 0)), 0);
  console.log('\n---------------------------------------------');
  console.log(`Confirmed matches: ${by('confirmed').length + by('imported').length}`);
  console.log(`Need a human ("ask"): ${by('ask').length + by('skipped').length}`);
  console.log(`No iTunes match: ${by('no-match').length}`);
  console.log(`Nothing new: ${by('nothing-new').length}`);
  console.log(`Failed: ${by('failed').length}`);
  console.log(APPLY ? `Songs imported: ${totalNew}` : `Songs that would be imported: ${totalNew}`);

  const ask = [...by('ask'), ...by('skipped')];
  if (ask.length) {
    console.log('\nNeeds a human — same name on iTunes, but nothing to verify it with:');
    for (const r of ask) console.log(`  ${r.name} -> "${r.itunesName}" [${r.genre}] ${r.newTracks} tracks, e.g. ${r.sample?.slice(0, 3).join(' / ')}`);
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(rows, null, 2));
    console.log(`\nFull results: ${JSON_OUT}`);
  }
  await prisma.$disconnect();
})();
