/**
 * Import rap-show contestants, judges and hosts from prisma/data/show-contestants.json
 * (generated from the MTV Hustle / LEGACY research spreadsheets).
 *
 *   npx tsx scripts/import-show-contestants.ts --dry   # preview, no writes
 *   npx tsx scripts/import-show-contestants.ts         # apply
 *
 * Rules
 *  - Existing artists are matched by name / handle / slug (plus a few known aliases) and only
 *    have EMPTY fields filled in - nothing already in the DB is overwritten.
 *  - New artists get a @handle: their Instagram username if given, else @stage_name.
 *  - Each season's cast is replaced by the spreadsheet's cast (it is the more complete source).
 *  - TV presenters who aren't artists are skipped as hosts.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { ShowRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { slugify, uniqueSlug } from '../src/lib/slug';
import { autoHandle, handleAfterInstagramChange, uniqueHandle } from '../src/lib/handles';
import { instagramUrl } from '../src/modules/images/wikipedia';

const DRY = process.argv.includes('--dry');

interface Contestant {
  name: string;
  realName: string;
  city: string;
  placement: string;
  about: string;
  instagram: string;
  youtube: string;
}
interface SeasonData {
  number: number;
  title: string | null;
  year: number | null;
  judges: string[];
  hosts: string[];
  contestants: Contestant[];
}
interface Data {
  shows: { name: string; seasons: SeasonData[] }[];
}

// Stage names in the sheets -> the name we store (and match on).
const ALIASES: Record<string, string> = {
  'akki on the mic': 'Akki On The Mic',
  akki: 'Akki On The Mic',
  husxain: 'Husxain',
  hussain: 'Husxain',
  'bawa pahadi / rap id': 'Bawa Pahadi',
  'rap id': 'Bawa Pahadi', // LEGACY sheet: "formerly known as Rap ID"
};
// Existing DB profiles that are the same person under an older/shorter name.
const EXISTING_ALIASES: Record<string, string> = { 'Akki On The Mic': 'akki', Husxain: 'hussain' };
const NOTES: Record<string, string> = { 'Bawa Pahadi': 'Formerly known as Rap ID.' };

// Presenters (not rappers) - not added as artist profiles.
const NON_ARTIST_HOSTS = new Set(['gaelyn mendonca', 'krissann barretto', 'samarth jurel']);

// ---------- cities ----------

const CITY_ALIASES: Record<string, string> = { 'new delhi': 'Delhi', bangalore: 'Bengaluru' };
const CITY_STATE: Record<string, string> = {
  delhi: 'Delhi NCR',
  mumbai: 'Maharashtra',
  pune: 'Maharashtra',
  jodhpur: 'Rajasthan',
  ludhiana: 'Punjab',
  gurgaon: 'Haryana',
  tripura: 'Tripura',
  rajasthan: 'Rajasthan',
};

/** "Delhi – Pitampura" -> Delhi; "Dharavi, Mumbai" -> Mumbai; "Jodhpur / Mumbai" -> Jodhpur. */
function parseCity(raw: string): { name: string; state: string | null } | null {
  if (!raw) return null;
  let first = raw.split('/')[0].trim();
  first = first.split(/\s+[–-]\s+/)[0].trim(); // drop neighbourhood after a dash
  const [a, b] = first.split(',').map((s) => s.trim());
  let city = a;
  let state = b ?? null;
  if (b && CITY_STATE[b.toLowerCase()] && !/pradesh|maharashtra|haryana|rajasthan|telangana|gujarat|bihar|uttarakhand|jharkhand|himachal/i.test(b)) {
    city = b; // "Dharavi, Mumbai"
    state = null;
  }
  // "Mumbai – Govandi, Maharashtra": state is after the comma of the full string.
  if (!state && raw.includes(',')) state = raw.split(',').pop()!.trim();
  city = CITY_ALIASES[city.toLowerCase()] ?? city;
  state = state && state.toLowerCase() !== city.toLowerCase() ? state : (CITY_STATE[city.toLowerCase()] ?? state);
  return { name: city, state };
}

const regionCache = new Map<string, string>();
async function regionId(raw: string, log: string[]): Promise<string | null> {
  const parsed = parseCity(raw);
  if (!parsed) return null;
  const key = parsed.name.toLowerCase();
  if (regionCache.has(key)) return regionCache.get(key)!;
  const existing = await prisma.region.findFirst({ where: { name: { equals: parsed.name, mode: 'insensitive' } }, select: { id: true } });
  if (existing) {
    regionCache.set(key, existing.id);
    return existing.id;
  }
  log.push(`+ city ${parsed.name}${parsed.state ? ', ' + parsed.state : ''}`);
  if (DRY) {
    regionCache.set(key, `dry-${key}`);
    return `dry-${key}`;
  }
  const slug = await uniqueSlug(parsed.name, async (s) => !!(await prisma.region.findUnique({ where: { slug: s } })));
  const created = await prisma.region.create({ data: { slug, name: parsed.name, state: parsed.state }, select: { id: true } });
  regionCache.set(key, created.id);
  return created.id;
}

// ---------- artists ----------

const norm = (s: string) => s.toLowerCase().replace(/\$/g, 's').replace(/δ/g, 'a').replace(/[^a-z0-9]/g, '');
const canonical = (name: string) => ALIASES[name.trim().toLowerCase()] ?? name.trim();
const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

interface ArtistRow {
  id: string;
  name: string;
  handle: string | null;
  realName: string | null;
  bio: string | null;
  regionId: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
}
const artistSelect = { id: true, name: true, handle: true, realName: true, bio: true, regionId: true, instagramUrl: true, youtubeUrl: true } as const;
const byKey = new Map<string, ArtistRow>();

async function loadArtists() {
  const all = await prisma.artist.findMany({ select: { ...artistSelect, slug: true } });
  for (const a of all) {
    for (const k of [norm(a.name), norm(a.slug), a.handle ? norm(a.handle) : '']) if (k && !byKey.has(k)) byKey.set(k, a);
  }
}

const stats = { created: 0, updated: 0, matched: 0 };

async function ensureArtist(rawName: string, info: Partial<Contestant>, log: string[]): Promise<string> {
  const name = canonical(rawName);
  const legacyKey = EXISTING_ALIASES[name];
  let existing = byKey.get(norm(name)) ?? (legacyKey ? byKey.get(norm(legacyKey)) : undefined);

  const ig = info.instagram?.startsWith('@') ? info.instagram.slice(1) : null;
  const igUrl = ig ? instagramUrl(ig) : null;
  const youtube = info.youtube && /^https?:\/\//.test(info.youtube) ? info.youtube : null;
  const realName = clean(info.realName) && info.realName!.trim().toLowerCase() !== name.toLowerCase() ? info.realName!.trim() : null;
  const bio = [clean(info.about), NOTES[name]].filter(Boolean).join(' ') || null;
  const region = info.city ? await regionId(info.city, log) : null;

  if (existing) {
    const data: Record<string, unknown> = {};
    if (existing.name !== name) data.name = name; // e.g. "Akki" -> "Akki On The Mic"
    if (!existing.realName && realName) data.realName = realName;
    if (!existing.bio && bio) data.bio = bio;
    if (!existing.regionId && region) data.regionId = region;
    if (!existing.youtubeUrl && youtube) data.youtubeUrl = youtube;
    if (!existing.instagramUrl && igUrl) {
      data.instagramUrl = igUrl;
      const h = DRY ? ig : await handleAfterInstagramChange(existing, igUrl);
      if (h) data.handle = h;
    }
    if (Object.keys(data).length) {
      stats.updated++;
      log.push(`~ ${existing.name}: ${Object.keys(data).join(', ')}${data.handle ? ` (@${data.handle})` : ''}${data.name ? ` -> "${name}"` : ''}`);
      if (!DRY) existing = await prisma.artist.update({ where: { id: existing.id }, data, select: artistSelect });
      else existing = { ...existing, ...(data as Partial<ArtistRow>) };
    } else stats.matched++;
    byKey.set(norm(name), existing!);
    return existing!.id;
  }

  stats.created++;
  const handle = DRY ? autoHandle({ name, instagramUrl: igUrl }) : await uniqueHandle(autoHandle({ name, instagramUrl: igUrl }));
  log.push(`+ ${name} @${handle}${realName ? ` (${realName})` : ''}${info.city ? ` · ${parseCity(info.city)?.name}` : ''}`);
  if (DRY) {
    const fake: ArtistRow = { id: `dry-${norm(name)}`, name, handle, realName, bio, regionId: region, instagramUrl: igUrl, youtubeUrl: youtube };
    byKey.set(norm(name), fake);
    return fake.id;
  }
  const slug = await uniqueSlug(slugify(name), async (s) => !!(await prisma.artist.findUnique({ where: { slug: s } })));
  const created = await prisma.artist.create({
    data: { slug, name, handle, realName, bio, regionId: region, instagramUrl: igUrl, youtubeUrl: youtube },
    select: artistSelect,
  });
  byKey.set(norm(name), created);
  return created.id;
}

function roleFor(placement: string): { role: ShowRole; placement: string | null } {
  const p = placement.trim();
  if (/^winner$/i.test(p)) return { role: 'WINNER', placement: null };
  if (/^runner-?up$/i.test(p)) return { role: 'RUNNER_UP', placement: null };
  if (/^3rd$/i.test(p)) return { role: 'FINALIST', placement: '3rd' };
  return { role: 'CONTESTANT', placement: p || null };
}

// LEGACY S1 finale (fan coverage): winner + top 3; the sheet has no placements.
const LEGACY_ROLES: Record<string, ShowRole> = { Prathamesh: 'WINNER', 'Akki On The Mic': 'FINALIST', Husxain: 'FINALIST' };

(async () => {
  const data: Data = JSON.parse(fs.readFileSync(path.join(__dirname, '../prisma/data/show-contestants.json'), 'utf8'));
  await loadArtists();
  console.log(DRY ? '*** DRY RUN - nothing is written ***\n' : '');

  for (const showData of data.shows) {
    const slug = slugify(showData.name);
    const show = DRY
      ? await prisma.show.findUnique({ where: { slug } })
      : await prisma.show.upsert({ where: { slug }, create: { slug, name: showData.name }, update: {} });

    for (const s of showData.seasons) {
      const log: string[] = [];
      const cast = new Map<string, { artistId: string; role: ShowRole; placement: string | null }>();
      const add = (artistId: string, role: ShowRole, placement: string | null) => cast.set(`${artistId}:${role}`, { artistId, role, placement });

      for (const raw of s.contestants) {
        // Some sheet rows are shifted: the finish ("12-13", "14th") landed in the City column.
        const shifted = !raw.placement && /^\d+(st|nd|rd|th)?(\s*-\s*\d+)?$/i.test(raw.city);
        const c = shifted ? { ...raw, placement: raw.city, city: '' } : raw;
        const id = await ensureArtist(c.name, c, log);
        const r = showData.name === 'Legacy' ? { role: LEGACY_ROLES[canonical(c.name)] ?? 'CONTESTANT', placement: null } : roleFor(c.placement);
        add(id, r.role, r.placement);
      }
      for (const j of s.judges) add(await ensureArtist(j, {}, log), 'JUDGE', null);
      for (const h of s.hosts) {
        if (NON_ARTIST_HOSTS.has(h.toLowerCase())) {
          log.push(`- skipped host ${h} (presenter, not an artist)`);
          continue;
        }
        add(await ensureArtist(h, {}, log), 'HOST', null);
      }

      console.log(`== ${showData.name} S${s.number}${s.year ? ` (${s.year})` : ''}${s.title ? ` "${s.title}"` : ''}: ${cast.size} cast`);
      log.forEach((l) => console.log('   ' + l));

      if (!DRY && show) {
        const season = await prisma.showSeason.upsert({
          where: { showId_number: { showId: show.id, number: s.number } },
          create: { showId: show.id, number: s.number, year: s.year, title: s.title },
          update: { year: s.year ?? undefined, ...(s.title && { title: s.title }) },
        });
        await prisma.$transaction([
          prisma.showAppearance.deleteMany({ where: { seasonId: season.id } }),
          prisma.showAppearance.createMany({ data: [...cast.values()].map((c) => ({ ...c, seasonId: season.id })) }),
        ]);
      }
    }
  }
  console.log(`\nArtists: ${stats.created} new, ${stats.updated} existing updated, ${stats.matched} existing unchanged.`);
  await prisma.$disconnect();
})();
