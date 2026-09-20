/**
 * Catalog import from iTunes: preview what's missing for an artist, create the picked
 * songs (and their albums), and undo a run in one click.
 *
 * Every run records exactly which album and song rows it created, so undo deletes those
 * and nothing else — anything you added or edited by hand is never touched.
 */
import { AlbumType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/http';
import { slugify, uniqueSlug } from '../../lib/slug';
import { artistTracks, artwork, searchArtists, type ItunesTrack } from './itunes';

/** "KR$NA" -> "krsna", "MC STΔN" -> "mcstan": spelling noise shouldn't break matching. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[Δδ]/g, 'a')
    .replace(/\$/g, 's')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

/** Titles differ by decoration only: "Song (feat. X)" and "Song - Single" are the same song. */
const titleKey = (title: string) =>
  norm(
    title
      .replace(/\s*[([].*?(feat\.?|ft\.?|with|prod\.?).*?[)\]]/gi, '')
      .replace(/\s*-\s*(single|ep)$/i, '')
      .replace(/\s*[([](remaster(ed)?|radio edit|explicit|clean).*?[)\]]/gi, ''),
  );

/** Junk iTunes carries alongside real releases. */
const JUNK = /(karaoke|instrumental version|tribute to|made famous by|sped up|slowed( \+ reverb)?|nightcore|cover version)/i;

const ALBUM_TYPE = (track: ItunesTrack): AlbumType => {
  const count = track.trackCount ?? 1;
  if (count <= 1) return 'SINGLE';
  if (/- ep$/i.test(track.collectionName ?? '')) return 'EP';
  return count <= 6 ? 'EP' : 'ALBUM';
};

export interface PreviewTrack {
  itunesTrackId: string;
  title: string;
  albumName: string | null;
  itunesCollectionId: string | null;
  albumType: AlbumType;
  trackNumber: number | null;
  releaseDate: string | null;
  durationSec: number | null;
  explicit: boolean;
  genre: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  /** Why it won't be imported: we have it, it's junk, or it's someone else's song. */
  skip: 'already-here' | 'junk' | 'other-artist' | null;
  existingSongTitle: string | null;
  /** Set when the track belongs to another artist and ours is only featured on it. */
  creditedTo: string | null;
}

export async function findCandidates(artistId: string) {
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { name: true, itunesId: true } });
  if (!artist) throw notFound('Artist');
  const results = await searchArtists(artist.name);
  return {
    artistName: artist.name,
    savedItunesId: artist.itunesId,
    candidates: results.map((c) => ({
      itunesId: String(c.artistId),
      name: c.artistName,
      genre: c.primaryGenreName ?? null,
      url: c.artistLinkUrl ?? null,
      exactName: norm(c.artistName) === norm(artist.name),
    })),
  };
}

export async function preview(artistId: string, itunesId: string) {
  const artist = await prisma.artist.findUnique({
    where: { id: artistId },
    select: { id: true, name: true, songs: { select: { title: true, itunesTrackId: true } } },
  });
  if (!artist) throw notFound('Artist');

  const mine = new Map(artist.songs.map((s) => [titleKey(s.title), s.title]));
  const tracks = await artistTracks(itunesId);

  // A track can already be here under a collaborator ("Seedhe Maut & KR$NA" lands under
  // Seedhe Maut). Importing it again would break the unique iTunes id, so skip it.
  const existingById = new Map(
    (
      await prisma.song.findMany({
        where: { itunesTrackId: { in: tracks.map((t) => String(t.trackId)) } },
        select: { itunesTrackId: true, title: true, artist: { select: { name: true } } },
      })
    ).map((s) => [s.itunesTrackId!, s]),
  );

  const seen = new Set<string>();
  const items: PreviewTrack[] = [];
  for (const t of tracks) {
    const key = titleKey(t.trackName);
    if (seen.has(key)) continue; // iTunes lists the same song on album + single
    seen.add(key);
    const elsewhere = existingById.get(String(t.trackId));
    const existing = mine.get(key) ?? (elsewhere ? `${elsewhere.title} (under ${elsewhere.artist.name})` : undefined);
    // iTunes lists tracks the artist is only featured on. Their own songs are the ones
    // they lead: "SAMBATA & Karan Kanchan" counts, "Phenom & SAMBATA" doesn't.
    const lead = t.artistName.split(/,| & | feat\.? | ft\.? | with | x /i)[0];
    const theirOwn = norm(lead) === norm(artist.name);
    items.push({
      creditedTo: theirOwn ? null : t.artistName,
      itunesTrackId: String(t.trackId),
      title: t.trackName,
      albumName: (t.trackCount ?? 1) > 1 ? (t.collectionName ?? null) : null,
      itunesCollectionId: (t.trackCount ?? 1) > 1 && t.collectionId ? String(t.collectionId) : null,
      albumType: ALBUM_TYPE(t),
      trackNumber: t.trackNumber ?? null,
      releaseDate: t.releaseDate ?? null,
      durationSec: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
      explicit: t.trackExplicitness === 'explicit',
      genre: t.primaryGenreName ?? null,
      coverUrl: artwork(t.artworkUrl100),
      previewUrl: t.trackViewUrl ?? null,
      skip: existing
        ? 'already-here'
        : !theirOwn
          ? 'other-artist'
          : JUNK.test(t.trackName)
            ? 'junk'
            : null,
      existingSongTitle: existing ?? null,
    });
  }
  return { artist: { id: artist.id, name: artist.name }, itunesId, items };
}

/**
 * Creates the picked tracks (plus any album they belong to) and records the batch.
 *
 * Everything is written in one transaction: if any row fails, the whole run rolls back
 * rather than leaving half an import behind. Slugs are resolved first, because slug
 * lookups on the shared client would deadlock against the transaction's connection.
 */
export async function run(input: { artistId: string; itunesId: string; trackIds: string[]; userId: string }) {
  const { artistId, itunesId, trackIds, userId } = input;
  if (!trackIds.length) throw badRequest('Pick at least one song');

  const { artist, items } = await preview(artistId, itunesId);
  const wanted = items.filter((t) => trackIds.includes(t.itunesTrackId) && t.skip !== 'already-here');
  if (!wanted.length) throw badRequest('Nothing left to import: those songs are already here');

  // Slugs must be unique against the database AND against the rest of this batch.
  const claimed = new Set<string>();
  const slugFor = (model: 'album' | 'song', base: string) =>
    uniqueSlug(slugify(base), async (s) => {
      if (claimed.has(s)) return true;
      const found = model === 'album' ? await prisma.album.findUnique({ where: { slug: s } }) : await prisma.song.findUnique({ where: { slug: s } });
      return !!found;
    }).then((s) => {
      claimed.add(s);
      return s;
    });

  // Plan the albums first: one row per iTunes collection, reusing any album we already have.
  type NewAlbum = { collectionId: string; title: string; type: AlbumType; releaseDate: Date | null; coverUrl: string | null; slug: string };
  const newAlbums: NewAlbum[] = [];
  const existingAlbumByCollection = new Map<string, string>();
  for (const t of wanted) {
    if (!t.itunesCollectionId || !t.albumName) continue;
    if (existingAlbumByCollection.has(t.itunesCollectionId) || newAlbums.some((a) => a.collectionId === t.itunesCollectionId)) continue;
    const existing = await prisma.album.findFirst({ where: { artistId, title: { equals: t.albumName, mode: 'insensitive' } }, select: { id: true } });
    if (existing) {
      existingAlbumByCollection.set(t.itunesCollectionId, existing.id);
      continue;
    }
    newAlbums.push({
      collectionId: t.itunesCollectionId,
      title: t.albumName,
      type: t.albumType,
      releaseDate: t.releaseDate ? new Date(t.releaseDate) : null,
      coverUrl: t.coverUrl,
      slug: await slugFor('album', `${artist.name} ${t.albumName}`),
    });
  }
  const songPlans = await Promise.all(
    wanted.map(async (t) => ({ track: t, slug: await slugFor('song', `${artist.name} ${t.title}`) })),
  );

  // Bulk inserts: one round trip each, so a 50-song import still fits in one transaction.
  return prisma.$transaction(
    async (tx) => {
      const albumIdByCollection = new Map(existingAlbumByCollection);
      const createdAlbums = newAlbums.length
        ? await tx.album.createManyAndReturn({
            data: newAlbums.map((a) => ({ artistId, title: a.title, type: a.type, releaseDate: a.releaseDate, coverUrl: a.coverUrl, slug: a.slug })),
            select: { id: true, slug: true },
          })
        : [];
      const albumIdBySlug = new Map(createdAlbums.map((a) => [a.slug, a.id]));
      for (const a of newAlbums) albumIdByCollection.set(a.collectionId, albumIdBySlug.get(a.slug)!);

      const createdSongs = await tx.song.createManyAndReturn({
        data: songPlans.map(({ track: t, slug }) => ({
          artistId,
          albumId: t.itunesCollectionId ? (albumIdByCollection.get(t.itunesCollectionId) ?? null) : null,
          title: t.title,
          slug,
          releaseDate: t.releaseDate ? new Date(t.releaseDate) : null,
          durationSec: t.durationSec,
          explicit: t.explicit,
          coverUrl: t.coverUrl,
          trackNumber: t.trackNumber,
          itunesTrackId: t.itunesTrackId,
        })),
        select: { id: true },
      });

      await tx.artist.update({ where: { id: artistId }, data: { itunesId } });
      return tx.importBatch.create({
        data: {
          artistId,
          artistName: artist.name,
          createdById: userId,
          albumIds: createdAlbums.map((a) => a.id),
          songIds: createdSongs.map((s) => s.id),
        },
        select: batchSelect,
      });
    },
    // Neon round trips are slow enough that the 5s default trips on a big import.
    { timeout: 60_000, maxWait: 15_000 },
  );
}

export const batchSelect = {
  id: true,
  source: true,
  label: true,
  updates: true,
  artistId: true,
  artistName: true,
  albumIds: true,
  songIds: true,
  createdAt: true,
  undoneAt: true,
  createdBy: { select: { username: true } },
  undoneBy: { select: { username: true } },
} satisfies Prisma.ImportBatchSelect;

/** What an undo would remove right now (some rows may have been deleted or edited since). */
export async function undoImpact(batchId: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound('Import');
  const [songs, albums, likes, playlistEntries] = await Promise.all([
    prisma.song.findMany({ where: { id: { in: batch.songIds } }, select: { id: true, title: true } }),
    prisma.album.findMany({ where: { id: { in: batch.albumIds } }, select: { id: true, title: true } }),
    prisma.songLike.count({ where: { songId: { in: batch.songIds } } }),
    prisma.playlistSong.count({ where: { songId: { in: batch.songIds } } }),
  ]);
  return { batch, songs, albums, likes, playlistEntries };
}

/** Deletes exactly the rows this run created. Hand-made rows are never touched. */
export async function undo(batchId: string, userId: string) {
  const { batch, songs, albums } = await undoImpact(batchId);
  if (batch.undoneAt) throw badRequest('This import was already undone');

  await prisma.$transaction([
    prisma.song.deleteMany({ where: { id: { in: songs.map((s) => s.id) } } }),
    // Albums the run created: any song added to them later just loses its album link.
    prisma.album.deleteMany({ where: { id: { in: albums.map((a) => a.id) } } }),
    prisma.importBatch.update({ where: { id: batchId }, data: { undoneAt: new Date(), undoneById: userId } }),
  ]);
  return { songsDeleted: songs.length, albumsDeleted: albums.length };
}
