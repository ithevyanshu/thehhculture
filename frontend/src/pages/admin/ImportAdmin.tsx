import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Download, ExternalLink, RotateCcw, Search, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useArtists } from '../../lib/queries';
import { Artwork } from '../../components/Artwork';
import { useDialog } from '../../components/Dialog';
import { Empty, Pagination, Spinner } from '../../components/ui';
import { year } from '../../lib/format';
import { SheetUpload } from './SheetUpload';
import type { AlbumType, ArtistCard, Paged } from '../../lib/types';

interface Candidate {
  itunesId: string;
  name: string;
  genre: string | null;
  url: string | null;
  exactName: boolean;
}

interface PreviewTrack {
  itunesTrackId: string;
  title: string;
  albumName: string | null;
  albumType: AlbumType;
  trackNumber: number | null;
  releaseDate: string | null;
  durationSec: number | null;
  explicit: boolean;
  genre: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  skip: 'already-here' | 'junk' | 'other-artist' | null;
  existingSongTitle: string | null;
  /** Set when iTunes credits the track to someone else and ours is only featured on it. */
  creditedTo: string | null;
}

interface Batch {
  id: string;
  source?: 'ITUNES' | 'SHEET';
  label?: string | null;
  artistId: string | null;
  artistName: string;
  albumIds: string[];
  songIds: string[];
  createdAt: string;
  undoneAt: string | null;
  createdBy: { username: string } | null;
  undoneBy: { username: string } | null;
}

// ---------- Import flow ----------

function ArtistSearch({ onPick }: { onPick: (a: ArtistCard) => void }) {
  const [q, setQ] = useState('');
  const artists = useArtists({ q, limit: 8 }, q.trim().length > 0);
  return (
    <div className="relative max-w-md">
      <input className="input" placeholder="Which artist? Search by name or @handle…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!!q.trim() && !!artists.data?.items.length && (
        <ul className="absolute z-20 mt-1 w-full border-2 border-ink bg-surface shadow-hard">
          {artists.data.items.map((a) => (
            <li key={a.id}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neon"
                onClick={() => {
                  onPick(a);
                  setQ('');
                }}
              >
                <div className="size-8 shrink-0 border border-ink">
                  <Artwork src={a.imageUrl} name={a.name} seed={a.slug} live />
                </div>
                <b className="uppercase">{a.name}</b>
                <span className="mono ml-auto text-muted">{a._count.songs} songs</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One iTunes track, ticked or not. Shared by the artist's listing and the search results. */
function TrackRow({ track: t, checked, onToggle }: { track: PreviewTrack; checked: boolean; onToggle: () => void }) {
  return (
    <tr className={`border-b border-dashed border-ink/25 last:border-b-0 ${t.skip ? 'bg-surface-2 text-muted' : ''}`}>
      <td className="px-2 py-1.5">
        <input type="checkbox" checked={checked} disabled={t.skip === 'already-here'} onChange={onToggle} aria-label={`Import ${t.title}`} />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          {t.coverUrl && <img src={t.coverUrl} alt="" className="size-8 shrink-0 border border-ink object-cover" loading="lazy" />}
          <div className="min-w-0">
            <p className="truncate font-bold">
              {t.title} {t.explicit && <span className="mono text-dim">E</span>}
            </p>
            {t.skip === 'already-here' && <p className="mono text-dim">already here as “{t.existingSongTitle}”</p>}
            {t.skip === 'junk' && <p className="mono text-dim">looks like a sped-up / karaoke version</p>}
            {t.skip === 'other-artist' && <p className="mono text-dim">iTunes credits “{t.creditedTo}” — tick it to add it here anyway</p>}
          </div>
        </div>
      </td>
      <td className="truncate px-2 py-1.5">{t.albumName ?? <span className="text-dim">Single</span>}</td>
      <td className="mono px-2 py-1.5">{year(t.releaseDate)}</td>
    </tr>
  );
}

const trackHead = (
  <thead className="mono sticky top-0 border-b-2 border-ink bg-paper">
    <tr>
      <th className="w-8 px-2 py-1.5"></th>
      <th className="px-2 py-1.5">Song</th>
      <th className="px-2 py-1.5">Release</th>
      <th className="w-16 px-2 py-1.5">Year</th>
    </tr>
  </thead>
);

/** iTunes throttles hard, so the search waits for a pause in the typing. */
function useDebounced(value: string, ms = 450) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/**
 * Search all of iTunes for one song at a time. The artist listing stops at 200 tracks and
 * leaves out anything Apple files under a collaborator, so this is how those get added.
 */
function SongSearch({ artist, picked, onToggle }: { artist: ArtistCard; picked: Set<string>; onToggle: (id: string) => void }) {
  const [term, setTerm] = useState(`${artist.name} `);
  const q = useDebounced(term.trim());

  const results = useQuery({
    queryKey: ['admin', 'import', 'search', artist.id, q],
    queryFn: () => api<{ term: string; items: PreviewTrack[] }>('/admin/import/search', { query: { artistId: artist.id, q } }),
    enabled: q.length > 1,
    placeholderData: (prev) => prev, // keep the last list on screen while the next one loads
  });

  return (
    <div className="border-t-2 border-dashed border-ink/30 pt-4">
      <p className="label">Add a single song by name</p>
      <p className="mb-2 text-xs text-dim">
        For features credited to someone else, and anything the listing above doesn't reach. Searching all of iTunes, so check the credit before ticking.
      </p>
      <div className="relative max-w-xl">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input !pl-9"
          placeholder="Artist and song title…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label="Search iTunes for a song"
        />
      </div>

      {results.isFetching && <Spinner label="Searching iTunes" />}
      {results.error && <p className="mt-2 text-sm text-red">{results.error instanceof ApiError ? results.error.message : 'Search failed'}</p>}
      {results.data && (
        <div className="mt-3">
          {results.data.items.length ? (
            <div className="max-h-96 overflow-y-auto border-2 border-ink">
              <table className="w-full text-left text-sm">
                {trackHead}
                <tbody>
                  {results.data.items.map((t) => (
                    <TrackRow key={t.itunesTrackId} track={t} checked={picked.has(t.itunesTrackId)} onToggle={() => onToggle(t.itunesTrackId)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">Nothing on iTunes for “{results.data.term}”. Fewer words usually helps.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Importer({ artist, onClose, onImported }: { artist: ArtistCard; onClose: () => void; onImported: (n: number) => void }) {
  const [itunesId, setItunesId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Ticked in the search results below, which the artist's listing may not contain at all. */
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const candidates = useQuery({
    queryKey: ['admin', 'import', 'candidates', artist.id],
    queryFn: () => api<{ artistName: string; savedItunesId: string | null; candidates: Candidate[] }>('/admin/import/candidates', { query: { artistId: artist.id } }),
  });

  const preview = useQuery({
    queryKey: ['admin', 'import', 'preview', artist.id, itunesId],
    queryFn: async () => {
      const data = await api<{ items: PreviewTrack[] }>('/admin/import/preview', { query: { artistId: artist.id, itunesId: itunesId! } });
      setPicked(new Set(data.items.filter((t) => !t.skip).map((t) => t.itunesTrackId))); // everything new, by default
      return data;
    },
    enabled: !!itunesId,
  });

  const trackIds = [...new Set([...picked, ...extra])];

  const importNow = async () => {
    if (!trackIds.length) return;
    setBusy(true);
    setError(null);
    try {
      const { batch } = await api<{ batch: Batch }>('/admin/import/run', { method: 'POST', body: { artistId: artist.id, itunesId, trackIds } });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['artist', artist.slug] });
      onImported(batch.songIds.length);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const items = preview.data?.items ?? [];
  const importable = items.filter((t) => !t.skip);
  const already = items.filter((t) => t.skip === 'already-here');
  const junk = items.filter((t) => t.skip === 'junk');
  const others = items.filter((t) => t.skip === 'other-artist');
  const flip = (id: string, set: (fn: (p: Set<string>) => Set<string>) => void) =>
    set((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  const toggle = (id: string) => flip(id, setPicked);
  const toggleExtra = (id: string) => flip(id, setExtra);

  return (
    <section className="mb-8 border-2 border-ink bg-surface shadow-hard">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-paper px-4 py-3">
        <div className="size-10 shrink-0 border border-ink">
          <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} live />
        </div>
        <h2 className="display flex-1 text-3xl">{artist.name}</h2>
        <button className="btn-ghost !px-3 !py-1.5" onClick={onClose}>
          <X size={14} /> Close
        </button>
      </header>

      <div className="space-y-4 p-4">
        {/* Step 1: which iTunes artist is this? */}
        {!itunesId && (
          <div>
            <p className="label">Which one is them on iTunes?</p>
            {candidates.isLoading ? (
              <Spinner />
            ) : candidates.error ? (
              <p className="text-sm text-red">{candidates.error instanceof ApiError ? candidates.error.message : 'iTunes lookup failed'}</p>
            ) : candidates.data?.candidates.length ? (
              <ul className="space-y-2">
                {candidates.data.candidates.map((c) => (
                  <li key={c.itunesId} className="flex flex-wrap items-center gap-3 border-2 border-ink bg-paper px-3 py-2">
                    <b className="uppercase">{c.name}</b>
                    <span className="mono text-muted">{c.genre ?? 'unknown genre'}</span>
                    {c.exactName && <span className="mono bg-neon px-1">name matches</span>}
                    {c.url && (
                      <a href={c.url} target="_blank" rel="noreferrer" className="mono text-saffron-soft hover:underline">
                        listen <ExternalLink size={11} className="inline" />
                      </a>
                    )}
                    <button className="btn-primary ml-auto !px-3 !py-1.5" onClick={() => setItunesId(c.itunesId)}>
                      This one
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Nobody with that name on iTunes">Search for their songs by name below, or add them by hand.</Empty>
            )}
          </div>
        )}

        {/* Step 2: pick what to add */}
        {itunesId && (preview.isLoading || !preview.data) && <Spinner label="Reading their catalog" />}
        {itunesId && preview.error && (
          <p className="text-sm text-red">{preview.error instanceof ApiError ? preview.error.message : 'Could not read their catalog'}</p>
        )}
        {itunesId && preview.data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="mono">
                {importable.length} new · {already.length} already here{junk.length ? ` · ${junk.length} skipped as junk` : ''}
                {others.length ? ` · ${others.length} credited elsewhere` : ''}
              </p>
              <button className="chip" onClick={() => setPicked(new Set(importable.map((t) => t.itunesTrackId)))}>
                Select all new
              </button>
              <button className="chip" onClick={() => setPicked(new Set())}>
                Select none
              </button>
              <button className="mono ml-auto text-muted hover:underline" onClick={() => setItunesId(null)}>
                wrong artist?
              </button>
            </div>

            <div className="max-h-[28rem] overflow-y-auto border-2 border-ink">
              <table className="w-full text-left text-sm">
                {trackHead}
                <tbody>
                  {items.map((t) => (
                    <TrackRow key={t.itunesTrackId} track={t} checked={picked.has(t.itunesTrackId)} onToggle={() => toggle(t.itunesTrackId)} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <SongSearch artist={artist} picked={extra} onToggle={toggleExtra} />

        {error && <p className="text-sm text-red">{error}</p>}
        <div className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-ink/30 pt-4">
          <button className="btn-primary" disabled={busy || !trackIds.length} onClick={importNow}>
            <Download size={14} /> {busy ? 'Importing…' : `Import ${trackIds.length} song${trackIds.length === 1 ? '' : 's'}`}
          </button>
          {!!extra.size && (
            <span className="mono text-muted">
              {extra.size} from search{picked.size ? ` · ${picked.size} from the listing` : ''}
            </span>
          )}
          <p className="text-xs text-dim">Albums are created as needed. Anything you regret, undo below in one click.</p>
        </div>
      </div>
    </section>
  );
}

// ---------- History with undo ----------

function History() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['admin', 'import', 'batches', page],
    queryFn: () => api<Paged<Batch>>('/admin/import/batches', { query: { page, limit: 20 } }),
    placeholderData: (prev) => prev,
  });

  const undo = async (b: Batch) => {
    const impact = await api<{ songs: string[]; albums: string[]; artists: string[]; restores: number; likes: number; playlistEntries: number }>(
      `/admin/import/batches/${b.id}/impact`,
    );
    const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
    const deletes = [
      impact.songs.length && plural(impact.songs.length, 'song'),
      impact.albums.length && plural(impact.albums.length, 'release'),
      impact.artists.length && plural(impact.artists.length, 'artist'),
    ].filter(Boolean);
    const extra = [impact.likes && plural(impact.likes, 'like'), impact.playlistEntries && plural(impact.playlistEntries, 'playlist entry', 'playlist entries')]
      .filter(Boolean)
      .join(' and ');

    const what = [
      impact.restores && `puts back ${plural(impact.restores, 'edited row')}`,
      deletes.length && `deletes ${deletes.join(', ')}`,
    ]
      .filter(Boolean)
      .join(' and ');
    const subject = b.source === 'SHEET' ? (b.label ?? 'this upload') : b.artistName;
    const ok = await dialog.confirm(
      `Undo ${subject}? It ${what || 'changes nothing'}.` + (extra ? ` That also removes ${extra}.` : '') + ' Nothing else you edited by hand is touched.',
      { danger: true, confirmLabel: 'Undo' },
    );
    if (!ok) return;
    setBusy(b.id);
    try {
      await api(`/admin/import/batches/${b.id}/undo`, { method: 'POST' });
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['artist'] });
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <Spinner />;
  return (
    <section>
      <h2 className="display mb-1 text-3xl">Import history</h2>
      <p className="mb-4 text-sm text-muted">Each run remembers exactly what it created, so undo removes that and nothing else.</p>
      {data.items.length ? (
        <>
          <div className="border-2 border-ink bg-surface">
            {data.items.map((b) => (
              <div key={b.id} className={`flex flex-wrap items-center gap-3 border-b border-dashed border-ink/25 px-3 py-2 last:border-b-0 ${b.undoneAt ? 'text-muted' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold uppercase">
                    {b.artistName}
                    {b.label && <span className="mono ml-2 normal-case text-muted">{b.label}</span>}
                  </p>
                  <p className="mono text-muted">
                    {b.songIds.length} songs · {b.albumIds.length} releases · {new Date(b.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    {b.createdBy && ` · @${b.createdBy.username}`}
                  </p>
                </div>
                {b.undoneAt ? (
                  <span className="mono flex items-center gap-1 border-2 border-ink bg-surface-2 px-2 py-1">
                    <Check size={12} /> undone{b.undoneBy ? ` by @${b.undoneBy.username}` : ''}
                  </span>
                ) : (
                  <button className="mono flex items-center gap-1 border-2 border-ink bg-surface px-2 py-1 hover:bg-red hover:text-paper disabled:opacity-40" disabled={busy === b.id} onClick={() => undo(b)}>
                    <RotateCcw size={12} /> {busy === b.id ? 'Undoing…' : 'Undo'}
                  </button>
                )}
              </div>
            ))}
          </div>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      ) : (
        <Empty title="No imports yet" />
      )}
    </section>
  );
}

export function ImportAdmin() {
  const [artist, setArtist] = useState<ArtistCard | null>(null);
  const [done, setDone] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      <section>
        <h2 className="display mb-1 text-3xl">Import releases</h2>
        <p className="mb-4 max-w-2xl text-sm text-muted">
          Pulls an artist's songs and albums from iTunes (free, no account), or adds single songs you search for by name. Songs you already have are matched by
          title and left alone, and every run can be undone in one click.
        </p>
        {done && (
          <p className="mb-4 flex items-center gap-2 border-2 border-ink bg-neon px-3 py-2 text-sm font-semibold shadow-hard-sm" role="status">
            <Check size={14} /> {done}
          </p>
        )}
        {!artist && <ArtistSearch onPick={setArtist} />}
      </section>

      {artist && (
        <Importer
          artist={artist}
          onClose={() => setArtist(null)}
          onImported={(n) => setDone(`Imported ${n} song${n === 1 ? '' : 's'} for ${artist.name}. Check the artist's page, and undo below if it looks wrong.`)}
        />
      )}

      <SheetUpload onApplied={setDone} />

      <History />
    </div>
  );
}
