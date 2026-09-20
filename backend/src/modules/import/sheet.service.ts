/**
 * Spreadsheet upload: read an .xlsx or .csv of songs, albums or artists, show exactly
 * what would change, then apply it in one undoable batch.
 *
 * Rules that make bulk edits safe:
 *  - a blank cell means "leave it alone", so a file can carry one column of fixes;
 *  - rows are matched on identity columns (@handle, or artist + title);
 *  - every change records the previous value, so Undo puts the old data back.
 */
import { AlbumType, Prisma } from '@prisma/client';
import readXlsx from 'read-excel-file/node';
import writeXlsx from 'write-excel-file/node';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/http';
import { slugify, uniqueSlug } from '../../lib/slug';
import { autoHandle, HANDLE_RE, normalizeHandle, uniqueHandle } from '../../lib/handles';
import { instagramUrl } from '../images/wikipedia';
import { columnByHeader, headerKey, SHEETS, type SheetKind } from './sheet.columns';
import { norm } from './import.service';

// ---------- Template ----------

/** The downloadable .xlsx: headers, one example row and a sheet explaining each column. */
export async function template(kind: SheetKind) {
  const { columns, label, note } = SHEETS[kind];
  const header = columns.map((c) => ({
    value: c.header,
    fontWeight: 'bold' as const,
    backgroundColor: c.required ? '#F05A0A' : '#E8E0CF',
    color: c.required ? '#FFFFFF' : '#16130F',
    borderStyle: 'thin' as const,
  }));
  const example = columns.map((c) => ({ value: c.example || null, type: String }));
  const notes = [
    [{ value: `${label} — how to fill this in`, fontWeight: 'bold' as const, span: 2 }],
    [{ value: note, span: 2 }],
    [{ value: 'Blank cells are left unchanged. Orange columns are required.', span: 2 }],
    [],
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'What it does', fontWeight: 'bold' as const }],
    ...columns.map((c) => [{ value: c.header + (c.required ? ' *' : '') }, { value: c.hint }]),
  ];

  // The published types only describe the single-sheet form.
  // In buffer mode it hands back an object with toBuffer().
  const write = writeXlsx as unknown as (sheets: unknown, options: unknown) => Promise<{ toBuffer: () => Promise<Buffer> }>;
  const out = await write(
    [
      { name: label.slice(0, 31), data: [header, example], columns: columns.map((c) => ({ width: Math.max(14, Math.min(34, c.header.length + 8)) })) },
      { name: 'How to fill it in', data: notes, columns: [{ width: 22 }, { width: 80 }] },
    ],
    { buffer: true },
  );
  return out.toBuffer();
}

// ---------- Reading ----------

type Cell = string | number | boolean | Date | null;
type Row = Record<string, Cell>;

const text = (v: Cell) => (v === null || v === undefined ? null : String(v).trim() || null);
const yesNo = (v: Cell) => {
  const s = text(v)?.toLowerCase();
  if (!s) return undefined;
  return ['yes', 'y', 'true', '1', 'explicit'].includes(s);
};
const number = (v: Cell) => {
  const s = text(v);
  if (!s) return undefined;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : undefined;
};
const date = (v: Cell) => {
  if (v instanceof Date) return v;
  const s = text(v);
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`"${s}" is not a date (use YYYY-MM-DD)`);
  return d;
};
const list = (v: Cell) =>
  text(v)
    ?.split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
const spotifyId = (v: Cell) => {
  const s = text(v);
  return s ? (s.match(/(?:track|album|artist)[/:]([A-Za-z0-9]{22})/)?.[1] ?? s) : undefined;
};
const youtubeId = (v: Cell) => {
  const s = text(v);
  return s ? (s.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ?? s) : undefined;
};

/** Reads .xlsx or .csv into rows keyed by normalised header. */
export async function readRows(file: Buffer, filename: string, kind: SheetKind): Promise<Row[]> {
  const known = columnByHeader(kind);
  let table: Cell[][];

  if (/\.csv$/i.test(filename)) {
    const lines = file.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
    table = lines.map((line) => {
      // Minimal CSV: quoted fields may contain commas and doubled quotes.
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quoted) {
          if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
          else if (c === '"') quoted = false;
          else cur += c;
        } else if (c === '"') quoted = true;
        else if (c === ',') (cells.push(cur), (cur = ''));
        else cur += c;
      }
      cells.push(cur);
      return cells.map((c) => c.trim());
    });
  } else {
    // A workbook can hold several sheets (our template carries a "How to fill it in"
    // one), so use whichever sheet has the most matching column titles.
    const read = readXlsx as unknown as (f: Buffer) => Promise<unknown>;
    const result = await read(file);
    const sheets: Cell[][][] =
      Array.isArray(result) && result[0] && !Array.isArray(result[0]) && 'data' in (result[0] as object)
        ? (result as { data: Cell[][] }[]).map((s) => s.data)
        : [result as Cell[][]];
    table = sheets.sort(
      (a, b) =>
        (b[0] ?? []).filter((h) => known.has(headerKey(String(h ?? '')))).length -
        (a[0] ?? []).filter((h) => known.has(headerKey(String(h ?? '')))).length,
    )[0] ?? [];
  }

  if (!table.length) throw badRequest('That file has no rows');
  const headers = (table[0] ?? []).map((h) => headerKey(String(h ?? '')));
  const matched = headers.filter((h) => known.has(h));
  if (!matched.length) {
    throw badRequest(`None of the column titles match the ${SHEETS[kind].label} template. Download the template and keep its first row.`);
  }

  return table
    .slice(1)
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? null) as Cell])))
    .filter((row) => Object.values(row).some((v) => text(v)));
}

// ---------- Preview ----------

export type RowAction = 'create' | 'update' | 'unchanged' | 'error';
export interface RowPlan {
  row: number;
  action: RowAction;
  label: string;
  /** Field -> [before, after] for an update, or the values for a new row. */
  changes: Record<string, [unknown, unknown]>;
  error?: string;
  targetId?: string;
  /** Artists that would be created because a handle isn't in the catalog yet. */
  newArtists?: string[];
}

interface Lookups {
  artistByHandle: Map<string, { id: string; name: string }>;
  artistByName: Map<string, { id: string; name: string }>;
  genreBySlug: Map<string, { id: string; name: string; slug: string }>;
  regionByName: Map<string, { id: string; name: string }>;
}

async function lookups(): Promise<Lookups> {
  const [artists, genres, regions] = await Promise.all([
    prisma.artist.findMany({ select: { id: true, name: true, handle: true } }),
    prisma.genre.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.region.findMany({ select: { id: true, name: true } }),
  ]);
  return {
    artistByHandle: new Map(artists.flatMap((a) => (a.handle ? [[a.handle, { id: a.id, name: a.name }] as const] : []))),
    artistByName: new Map(artists.map((a) => [norm(a.name), { id: a.id, name: a.name }])),
    genreBySlug: new Map(genres.flatMap((g) => [[g.slug, g] as const, [norm(g.name), g] as const])),
    regionByName: new Map(regions.map((r) => [norm(r.name), r])),
  };
}

const findArtist = (raw: string | null, L: Lookups) => {
  if (!raw) return null;
  const handle = normalizeHandle(raw.replace(/^@/, ''));
  return L.artistByHandle.get(handle) ?? L.artistByName.get(norm(raw)) ?? null;
};

/** Only the fields the row actually sets, and only where they differ from what's stored. */
function diff(current: Record<string, unknown> | null, next: Record<string, unknown>) {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const before = current?.[k] ?? null;
    const same = before instanceof Date && v instanceof Date ? before.getTime() === v.getTime() : JSON.stringify(before ?? null) === JSON.stringify(v ?? null);
    if (!same) changes[k] = [before ?? null, v];
  }
  return changes;
}

export async function preview(file: Buffer, filename: string, kind: SheetKind) {
  const rows = await readRows(file, filename, kind);
  const L = await lookups();
  const plans: RowPlan[] = [];
  // Rows can refer to things earlier rows create (an album added above, say).
  const pendingAlbums = new Set<string>();
  const pendingArtists = new Set<string>();

  for (const [i, row] of rows.entries()) {
    const at = i + 2; // spreadsheet line number, counting the header
    try {
      plans.push(await planRow(kind, row, at, L, pendingAlbums, pendingArtists));
    } catch (err) {
      plans.push({ row: at, action: 'error', label: '', changes: {}, error: err instanceof Error ? err.message : 'Could not read this row' });
    }
  }
  return { kind, filename, rows: plans, counts: count(plans) };
}

const count = (plans: RowPlan[]) => ({
  create: plans.filter((p) => p.action === 'create').length,
  update: plans.filter((p) => p.action === 'update').length,
  unchanged: plans.filter((p) => p.action === 'unchanged').length,
  error: plans.filter((p) => p.action === 'error').length,
});

const cell = (row: Row, header: string) => row[headerKey(header)] ?? null;

async function planRow(kind: SheetKind, row: Row, at: number, L: Lookups, pendingAlbums: Set<string>, pendingArtists: Set<string>): Promise<RowPlan> {
  if (kind === 'artists') return planArtist(row, at, L);
  if (kind === 'albums') return planAlbum(row, at, L, pendingAlbums);
  return planSong(row, at, L, pendingAlbums, pendingArtists);
}

async function planArtist(row: Row, at: number, L: Lookups): Promise<RowPlan> {
  const handle = text(cell(row, '@handle'));
  const name = text(cell(row, 'Name'));
  if (!handle && !name) throw new Error('Give an @handle or a name');
  const existing = findArtist(handle ?? name, L);

  const genres = list(cell(row, 'Genres'));
  const genreSlugs = genres?.map((g) => {
    const found = L.genreBySlug.get(norm(g)) ?? L.genreBySlug.get(slugify(g));
    if (!found) throw new Error(`Unknown genre "${g}"`);
    return found;
  });
  const cityName = text(cell(row, 'City'));
  const region = cityName ? L.regionByName.get(norm(cityName)) : undefined;
  if (cityName && !region) throw new Error(`Unknown city "${cityName}" — add it in Admin → Taxonomy first`);
  const newHandle = text(cell(row, 'New @handle'));
  if (newHandle && !HANDLE_RE.test(normalizeHandle(newHandle.replace(/^@/, '')))) throw new Error(`"${newHandle}" is not a valid handle`);
  const instagram = text(cell(row, 'Instagram'));

  const next = {
    name: existing ? (name ?? undefined) : name!,
    handle: newHandle ? normalizeHandle(newHandle.replace(/^@/, '')) : undefined,
    realName: text(cell(row, 'Real name')) ?? undefined,
    bio: text(cell(row, 'Bio')) ?? undefined,
    activeSince: number(cell(row, 'Active since')),
    imageUrl: text(cell(row, 'Photo URL')) ?? undefined,
    imageCredit: text(cell(row, 'Photo credit')) ?? undefined,
    youtubeUrl: text(cell(row, 'YouTube')) ?? undefined,
    spotifyUrl: text(cell(row, 'Spotify')) ?? undefined,
    isProducer: yesNo(cell(row, 'Producer')),
    instagramUrl: instagram ? instagramUrl(instagram.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '')) : undefined,
    regionId: region?.id,
    genreSlugs: genreSlugs?.map((g) => g.slug),
  };

  if (!existing) {
    if (!name) throw new Error('New artists need a Name');
    return { row: at, action: 'create', label: name, changes: diff(null, next) };
  }
  const current = await prisma.artist.findUniqueOrThrow({
    where: { id: existing.id },
    select: {
      name: true, handle: true, realName: true, bio: true, activeSince: true, imageUrl: true, imageCredit: true,
      youtubeUrl: true, spotifyUrl: true, isProducer: true, instagramUrl: true, regionId: true,
      genres: { select: { slug: true } },
    },
  });
  const changes = diff({ ...current, genreSlugs: current.genres.map((g) => g.slug) }, next);
  return { row: at, action: Object.keys(changes).length ? 'update' : 'unchanged', label: existing.name, changes, targetId: existing.id };
}

async function planAlbum(row: Row, at: number, L: Lookups, pendingAlbums: Set<string>): Promise<RowPlan> {
  const artistRaw = text(cell(row, 'Artist @handle'));
  const title = text(cell(row, 'Title'));
  if (!artistRaw || !title) throw new Error('Artist and Title are both needed');
  const artist = findArtist(artistRaw, L);
  if (!artist) throw new Error(`No artist "${artistRaw}" — add them in the Artists sheet first`);

  const typeRaw = text(cell(row, 'Type'))?.toUpperCase();
  if (typeRaw && !['ALBUM', 'EP', 'MIXTAPE', 'SINGLE'].includes(typeRaw)) throw new Error(`Type must be album, ep, mixtape or single (got "${typeRaw}")`);
  const next = {
    title: text(cell(row, 'New title')) ?? undefined,
    type: (typeRaw as AlbumType | undefined) ?? undefined,
    releaseDate: date(cell(row, 'Release date')),
    coverUrl: text(cell(row, 'Cover URL')) ?? undefined,
    spotifyId: spotifyId(cell(row, 'Spotify link')),
  };

  const existing = await prisma.album.findFirst({ where: { artistId: artist.id, title: { equals: title, mode: 'insensitive' } }, select: { id: true, title: true, type: true, releaseDate: true, coverUrl: true, spotifyId: true } });
  const label = `${artist.name} — ${title}`;
  if (!existing) {
    pendingAlbums.add(`${artist.id}:${norm(title)}`);
    return { row: at, action: 'create', label, changes: diff(null, { ...next, title: next.title ?? title }) };
  }
  const changes = diff(existing, next);
  return { row: at, action: Object.keys(changes).length ? 'update' : 'unchanged', label, changes, targetId: existing.id };
}

async function planSong(row: Row, at: number, L: Lookups, pendingAlbums: Set<string>, pendingArtists: Set<string>): Promise<RowPlan> {
  const artistRaw = text(cell(row, 'Artist @handle'));
  const title = text(cell(row, 'Title'));
  if (!artistRaw || !title) throw new Error('Artist and Title are both needed');
  const artist = findArtist(artistRaw, L);
  if (!artist) throw new Error(`No artist "${artistRaw}" — add them in the Artists sheet first`);

  const credited = (header: string) => {
    const names = list(cell(row, header));
    if (!names) return undefined;
    const ids: string[] = [];
    const missing: string[] = [];
    for (const n of names) {
      const found = findArtist(n, L);
      if (found) ids.push(found.id);
      else missing.push(n);
    }
    if (missing.length) throw new Error(`Unknown ${header.toLowerCase()}: ${missing.join(', ')} — add them in the Artists sheet first`);
    return ids;
  };

  const genres = list(cell(row, 'Genres'));
  const genreSlugs = genres?.map((g) => {
    const found = L.genreBySlug.get(norm(g)) ?? L.genreBySlug.get(slugify(g));
    if (!found) throw new Error(`Unknown genre "${g}"`);
    return found.slug;
  });

  const albumTitle = text(cell(row, 'Album'));
  let albumId: string | undefined;
  if (albumTitle) {
    const album = await prisma.album.findFirst({ where: { artistId: artist.id, title: { equals: albumTitle, mode: 'insensitive' } }, select: { id: true } });
    if (!album && !pendingAlbums.has(`${artist.id}:${norm(albumTitle)}`)) {
      throw new Error(`No album "${albumTitle}" for ${artist.name} — add it in the Albums sheet first`);
    }
    albumId = album?.id;
  }

  const next = {
    title: text(cell(row, 'New title')) ?? undefined,
    releaseDate: date(cell(row, 'Release date')),
    durationSec: number(cell(row, 'Duration (sec)')),
    trackNumber: number(cell(row, 'Track number')),
    coverUrl: text(cell(row, 'Cover URL')) ?? undefined,
    lyricsUrl: text(cell(row, 'Lyrics URL')) ?? undefined,
    spotifyTrackId: spotifyId(cell(row, 'Spotify link')),
    youtubeVideoId: youtubeId(cell(row, 'YouTube link')),
    explicit: yesNo(cell(row, 'Explicit')),
    albumId,
    genreSlugs,
    featureArtistIds: credited('Featuring'),
    producerArtistIds: credited('Produced by'),
  };

  const existing = await prisma.song.findFirst({
    where: { artistId: artist.id, title: { equals: title, mode: 'insensitive' } },
    select: {
      id: true, title: true, releaseDate: true, durationSec: true, trackNumber: true, coverUrl: true, lyricsUrl: true,
      spotifyTrackId: true, youtubeVideoId: true, explicit: true, albumId: true,
      genres: { select: { slug: true } }, features: { select: { artistId: true } }, producers: { select: { artistId: true } },
    },
  });
  const label = `${artist.name} — ${title}`;
  if (!existing) {
    void pendingArtists;
    return { row: at, action: 'create', label, changes: diff(null, { ...next, title: next.title ?? title }) };
  }
  const changes = diff(
    {
      ...existing,
      genreSlugs: existing.genres.map((g) => g.slug),
      featureArtistIds: existing.features.map((f) => f.artistId),
      producerArtistIds: existing.producers.map((p) => p.artistId),
    },
    next,
  );
  return { row: at, action: Object.keys(changes).length ? 'update' : 'unchanged', label, changes, targetId: existing.id };
}

// ---------- Applying ----------

type Before = { model: SheetKind; id: string; before: Record<string, unknown> };

/** Re-reads the file, then writes the rows that would change, recording the old values. */
export async function apply(file: Buffer, filename: string, kind: SheetKind, userId: string) {
  const { rows } = await preview(file, filename, kind);
  const todo = rows.filter((r) => r.action === 'create' || r.action === 'update');
  if (!todo.length) throw badRequest('Nothing to apply: every row is unchanged or has an error');

  if (todo.length > MAX_ROWS) throw badRequest(`That file changes ${todo.length} rows; split it into files of ${MAX_ROWS} or fewer`);

  const created = { artistIds: [] as string[], albumIds: [] as string[], songIds: [] as string[] };
  const updates: Before[] = [];
  const L = await lookups();

  // All or nothing: a file that fails halfway leaves nothing behind and nothing to undo.
  return prisma.$transaction(
    async (tx) => {
      for (const plan of todo) {
        const values = Object.fromEntries(Object.entries(plan.changes).map(([k, [, after]]) => [k, after]));
        if (kind === 'artists') await writeArtist(tx, plan, values, created, updates);
        else if (kind === 'albums') await writeAlbum(tx, plan, values, created, updates, L);
        else await writeSong(tx, plan, values, created, updates, L);
      }

      return tx.importBatch.create({
        data: {
          source: 'SHEET',
          artistName: `${SHEETS[kind].label} spreadsheet`,
          label: filename,
          createdById: userId,
          artistIds: created.artistIds,
          albumIds: created.albumIds,
          songIds: created.songIds,
          updates: updates as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, label: true, artistIds: true, albumIds: true, songIds: true, createdAt: true },
      });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
}

/** Each row is a few round trips to Neon, so keep an upload inside the transaction window. */
const MAX_ROWS = 400;

type Tx = Prisma.TransactionClient;

async function writeArtist(tx: Tx, plan: RowPlan, v: Record<string, unknown>, created: { artistIds: string[] }, updates: Before[]) {
  const { genreSlugs, ...data } = v as Record<string, unknown> & { genreSlugs?: string[] };
  if (plan.action === 'create') {
    const name = String(data.name ?? plan.label);
    const artist = await tx.artist.create({
      data: {
        ...(data as Prisma.ArtistCreateInput),
        name,
        slug: await uniqueSlug(slugify(name), async (s) => !!(await prisma.artist.findUnique({ where: { slug: s } }))),
        handle: data.handle ? await uniqueHandle(String(data.handle)) : await uniqueHandle(autoHandle({ name, instagramUrl: (data.instagramUrl as string) ?? null })),
        ...(genreSlugs && { genres: { connect: genreSlugs.map((s) => ({ slug: s })) } }),
      },
      select: { id: true },
    });
    created.artistIds.push(artist.id);
    return;
  }
  const id = plan.targetId!;
  updates.push({ model: 'artists', id, before: Object.fromEntries(Object.entries(plan.changes).map(([k, [before]]) => [k, before])) });
  await tx.artist.update({
    where: { id },
    data: { ...(data as Prisma.ArtistUpdateInput), ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }) },
  });
}

async function writeAlbum(tx: Tx, plan: RowPlan, v: Record<string, unknown>, created: { albumIds: string[] }, updates: Before[], L: Lookups) {
  if (plan.action === 'create') {
    const [artistName, title] = plan.label.split(' — ');
    const artist = findArtist(artistName, L)!;
    const album = await tx.album.create({
      data: {
        ...(v as Prisma.AlbumCreateInput),
        title: String(v.title ?? title),
        artist: { connect: { id: artist.id } },
        slug: await uniqueSlug(slugify(`${artistName} ${v.title ?? title}`), async (s) => !!(await prisma.album.findUnique({ where: { slug: s } }))),
      },
      select: { id: true },
    });
    created.albumIds.push(album.id);
    return;
  }
  const id = plan.targetId!;
  updates.push({ model: 'albums', id, before: Object.fromEntries(Object.entries(plan.changes).map(([k, [before]]) => [k, before])) });
  await tx.album.update({ where: { id }, data: v as Prisma.AlbumUpdateInput });
}

async function writeSong(tx: Tx, plan: RowPlan, v: Record<string, unknown>, created: { songIds: string[] }, updates: Before[], L: Lookups) {
  const { genreSlugs, featureArtistIds, producerArtistIds, ...data } = v as Record<string, unknown> & {
    genreSlugs?: string[];
    featureArtistIds?: string[];
    producerArtistIds?: string[];
  };
  const credits = {
    ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }),
    ...(featureArtistIds && { features: { deleteMany: {}, create: featureArtistIds.map((artistId) => ({ artistId })) } }),
    ...(producerArtistIds && { producers: { deleteMany: {}, create: producerArtistIds.map((artistId) => ({ artistId })) } }),
  };

  if (plan.action === 'create') {
    const [artistName, title] = plan.label.split(' — ');
    const artist = findArtist(artistName, L)!;
    const song = await tx.song.create({
      data: {
        ...(data as Prisma.SongCreateInput),
        title: String(data.title ?? title),
        artist: { connect: { id: artist.id } },
        slug: await uniqueSlug(slugify(`${artistName} ${data.title ?? title}`), async (s) => !!(await prisma.song.findUnique({ where: { slug: s } }))),
        ...(genreSlugs && { genres: { connect: genreSlugs.map((s) => ({ slug: s })) } }),
        ...(featureArtistIds && { features: { create: featureArtistIds.map((artistId) => ({ artistId })) } }),
        ...(producerArtistIds && { producers: { create: producerArtistIds.map((artistId) => ({ artistId })) } }),
      },
      select: { id: true },
    });
    created.songIds.push(song.id);
    if (producerArtistIds?.length) await tx.artist.updateMany({ where: { id: { in: producerArtistIds }, isProducer: false }, data: { isProducer: true } });
    return;
  }

  const id = plan.targetId!;
  updates.push({ model: 'songs', id, before: Object.fromEntries(Object.entries(plan.changes).map(([k, [before]]) => [k, before])) });
  await tx.song.update({ where: { id }, data: { ...(data as Prisma.SongUpdateInput), ...credits } });
  if (producerArtistIds?.length) await tx.artist.updateMany({ where: { id: { in: producerArtistIds }, isProducer: false }, data: { isProducer: true } });
}

// ---------- Undo ----------

/** Puts back what a spreadsheet upload changed: deletes what it created, restores what it edited. */
export async function undoSheet(batchId: string, userId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound('Upload');
  if (batch.undoneAt) throw badRequest('This upload was already undone');

  const updates = (batch.updates ?? []) as unknown as Before[];
  // One transaction, so a half-finished undo can't leave the catalog in between states.
  await prisma.$transaction(
    async (tx) => {
      for (const u of updates) {
        const { genreSlugs, featureArtistIds, producerArtistIds, ...fields } = u.before as Record<string, unknown> & {
          genreSlugs?: string[] | null;
          featureArtistIds?: string[] | null;
          producerArtistIds?: string[] | null;
        };
        // Dates come back from JSON as strings.
        const data = Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, k.endsWith('Date') && typeof val === 'string' ? new Date(val) : val]));
        if (u.model === 'artists') {
          await tx.artist.update({ where: { id: u.id }, data: { ...data, ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }) } });
        } else if (u.model === 'albums') {
          await tx.album.update({ where: { id: u.id }, data });
        } else {
          await tx.song.update({
            where: { id: u.id },
            data: {
              ...data,
              ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }),
              ...(featureArtistIds && { features: { deleteMany: {}, create: featureArtistIds.map((artistId) => ({ artistId })) } }),
              ...(producerArtistIds && { producers: { deleteMany: {}, create: producerArtistIds.map((artistId) => ({ artistId })) } }),
            },
          });
        }
      }

      await tx.song.deleteMany({ where: { id: { in: batch.songIds } } });
      await tx.album.deleteMany({ where: { id: { in: batch.albumIds } } });
      await tx.artist.deleteMany({ where: { id: { in: batch.artistIds } } });
      await tx.importBatch.update({ where: { id: batchId }, data: { undoneAt: new Date(), undoneById: userId } });
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  return { restored: updates.length, deleted: batch.songIds.length + batch.albumIds.length + batch.artistIds.length };
}
