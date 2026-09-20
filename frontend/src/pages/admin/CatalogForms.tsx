/**
 * Artist / album / song forms, shared by the admin panel and the Artist Studio.
 * In Studio mode the artist is fixed, requests go to /studio, and admin-only fields
 * (slug, verified, featured, Spotify IDs, Wikipedia search, creating artists or cities) are hidden.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useGenres, useRegions } from '../../lib/queries';
import { toHandle, typingHandle, year } from '../../lib/format';
import { Artwork } from '../../components/Artwork';
import { Spinner } from '../../components/ui';
import type { AlbumCard, AlbumType } from '../../lib/types';
import { HandleInput, type HandleRef } from '../../components/HandleInput';

/** Studio mode: the signed-in artist edits their own catalog. */
export interface StudioScope {
  artistId: string;
}

/** What the server did with a Studio submission. */
export type SubmitResult = { status?: 'APPLIED' | 'PENDING' } | undefined;

// ---------- helpers ----------

/** Accept a full Spotify URL/URI or a bare ID. */
function spotifyId(input: string) {
  const m = input.match(/(?:track|album|artist)[/:]([A-Za-z0-9]{22})/);
  return m ? m[1] : input.trim();
}

/** Accept youtube.com/watch?v=, youtu.be/, /shorts/ or a bare ID. */
function youtubeId(input: string) {
  const m = input.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : input.trim();
}

const dateInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

/** Studio updates send only what changed: smaller diffs for the reviewer, and nothing else is touched. */
function changedOnly<T extends Record<string, unknown>>(initial: Record<string, unknown>, body: T): Partial<T> {
  return Object.fromEntries(Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initial[k]))) as Partial<T>;
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-dim">{hint}</p>}
    </div>
  );
}

function MultiChips({ options, value, onChange }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            className={`chip ${on ? 'chip-active' : ''}`}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-2xl overflow-y-auto border-l-[3px] border-ink bg-paper p-6"
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="display text-3xl">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-ink/10" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function useSubmit(onDone: (result: SubmitResult) => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      onDone((await fn()) as SubmitResult);
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.details ? Object.entries(err.details).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : '';
        setError(details ? `${err.message} - ${details}` : err.message);
      } else setError('Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, setError };
}

function FormActions({ busy, error, onCancel }: { busy: boolean; error: string | null; onCancel: () => void }) {
  return (
    <div className="sticky bottom-0 -mx-6 mt-6 border-t border-line bg-surface px-6 py-4">
      {error && <p className="mb-3 rounded-none bg-pink/10 px-3 py-2 text-sm text-pink">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Artist image (Wikipedia picker) ----------

interface ImageCandidate {
  pageTitle: string;
  description: string | null;
  pageUrl: string;
  imageUrl: string;
  sourceUrl: string;
  credit: string | null;
}

type ArtistImage = { imageUrl: string; imageCredit: string; imageSourceUrl: string };

function ArtistImageField({
  artistName,
  value,
  onChange,
  wikipedia = true,
}: {
  artistName: string;
  value: ArtistImage;
  onChange: (v: ArtistImage) => void;
  /** Wikipedia photo search (admin-only endpoint). */
  wikipedia?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<ImageCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const q = query.trim() || `${artistName} rapper`;
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const { candidates } = await api<{ candidates: ImageCandidate[] }>('/admin/images/search', { method: 'POST', body: { query: q } });
      setCandidates(candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="border-2 border-dashed border-ink bg-surface p-4">
      <span className="label">Artist photo</span>
      <div className="flex gap-4">
        <div className="w-24 shrink-0">
          <Artwork src={value.imageUrl || null} name={artistName || '?'} round />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            className="input"
            type="url"
            placeholder="Image URL"
            value={value.imageUrl}
            // A manually entered URL no longer matches the stored Wikimedia credit.
            onChange={(e) => onChange({ imageUrl: e.target.value, imageCredit: '', imageSourceUrl: '' })}
          />
          <input
            className="input"
            placeholder="Photo credit (author / license)"
            value={value.imageCredit}
            onChange={(e) => onChange({ ...value, imageCredit: e.target.value })}
          />
          {value.imageUrl && (
            <button type="button" className="text-xs text-muted hover:text-pink" onClick={() => onChange({ imageUrl: '', imageCredit: '', imageSourceUrl: '' })}>
              Remove photo
            </button>
          )}
        </div>
      </div>

      {wikipedia && (
        <>
          <div className="mt-4 flex gap-2">
            <input
              className="input"
              placeholder={`Search Wikipedia (default: "${artistName || 'name'} rapper") or paste a Wikipedia URL`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  search();
                }
              }}
            />
            <button type="button" className="btn-ghost shrink-0" onClick={search} disabled={searching || (!query.trim() && !artistName)}>
              {searching ? 'Searching…' : 'Find on Wikipedia'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-pink">{error}</p>}

          {candidates && (
            <div className="mt-3">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted">No Wikipedia pages with photos found. Try another search or paste an article URL.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {candidates.map((c) => {
                    const selected = c.imageUrl === value.imageUrl;
                    return (
                      <button
                        type="button"
                        key={c.pageUrl}
                        onClick={() => onChange({ imageUrl: c.imageUrl, imageCredit: c.credit ?? '', imageSourceUrl: c.sourceUrl })}
                        className={`rounded-none border p-2 text-left transition ${selected ? 'border-saffron bg-saffron/10' : 'border-line hover:border-bone/40'}`}
                      >
                        <img src={c.imageUrl} alt="" className="aspect-square w-full rounded-none object-cover object-[center_25%]" />
                        <p className="mt-1.5 truncate text-xs font-semibold">{c.pageTitle}</p>
                        <p className="line-clamp-2 text-[11px] text-muted">{c.description ?? '-'}</p>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="mt-2 text-[11px] text-dim">Images come from Wikimedia Commons. The credit is saved and shown on the artist page, as their licenses require.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- City picker with inline "add new city" ----------

const NEW_CITY = '__new__';

function CityPicker({ value, onChange, allowCreate = true }: { value: string; onChange: (slug: string) => void; allowCreate?: boolean }) {
  const regions = useRegions();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', state: '' });
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const name = draft.name.trim();
    if (!name) return;
    setError(null);
    // Re-use an existing city if the name already exists (case-insensitive).
    const existing = regions.data?.items.find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      onChange(existing.slug);
      setAdding(false);
      return;
    }
    try {
      const { region } = await api<{ region: { slug: string } }>('/admin/regions', { method: 'POST', body: { name, state: draft.state } });
      await qc.invalidateQueries({ queryKey: ['regions'] });
      onChange(region.slug);
      setAdding(false);
      setDraft({ name: '', state: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add city');
    }
  };

  return (
    <div className="space-y-2">
      <select
        className="input"
        value={adding ? NEW_CITY : value}
        onChange={(e) => {
          if (e.target.value === NEW_CITY) setAdding(true);
          else {
            setAdding(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">-</option>
        {regions.data?.items.map((r) => (
          <option key={r.slug} value={r.slug}>
            {r.name}
            {r.state ? `, ${r.state}` : ''}
          </option>
        ))}
        {allowCreate && <option value={NEW_CITY}>+ Add a new city…</option>}
      </select>
      {adding && (
        <div className="flex flex-wrap items-end gap-2 border-2 border-dashed border-ink bg-paper p-2">
          <label className="min-w-32 flex-1">
            <span className="label !mb-0.5">City *</span>
            <input
              autoFocus
              className="input !py-1.5"
              placeholder="e.g. Nagpur"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            />
          </label>
          <label className="min-w-32 flex-1">
            <span className="label !mb-0.5">State</span>
            <input
              className="input !py-1.5"
              placeholder="e.g. Maharashtra"
              value={draft.state}
              onChange={(e) => setDraft({ ...draft, state: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            />
          </label>
          <button type="button" className="btn-primary !px-3 !py-2" onClick={add} disabled={!draft.name.trim()}>
            Add city
          </button>
          <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => setAdding(false)}>
            Cancel
          </button>
          {error && <p className="w-full text-sm text-red">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ---------- Artist form ----------

const emptyArtist = {
  name: '',
  slug: '',
  realName: '',
  bio: '',
  imageUrl: '',
  imageCredit: '',
  imageSourceUrl: '',
  bannerUrl: '',
  activeSince: '' as string | number,
  regionSlug: '',
  genreSlugs: [] as string[],
  verified: false,
  featured: false,
  isProducer: false,
  instagramUrl: '',
  youtubeUrl: '',
  spotifyUrl: '',
  spotifyId: '',
  handle: '',
};

/** Profile fields an artist may change in the Studio (mirrors studioProfileSchema on the server). */
const STUDIO_ARTIST_FIELDS = [
  'name',
  'handle',
  'realName',
  'activeSince',
  'bio',
  'imageUrl',
  'imageCredit',
  'bannerUrl',
  'regionSlug',
  'genreSlugs',
  'instagramUrl',
  'youtubeUrl',
  'spotifyUrl',
] as const;

export function ArtistForm({ id, onDone, studio }: { id: string | null; onDone: (result: SubmitResult) => void; studio?: StudioScope }) {
  const genres = useGenres();
  const [form, setForm] = useState(emptyArtist);
  const [initial, setInitial] = useState(emptyArtist);
  const [loaded, setLoaded] = useState(!id && !studio);
  const { error, busy, run } = useSubmit(onDone);

  useEffect(() => {
    if (!id && !studio) return;
    type Raw = Record<string, unknown> & { genres: { slug: string }[]; region: { slug: string } | null };
    const load = studio ? api<{ artist: Raw }>('/studio') : api<{ artist: Raw }>(`/admin/artists/${id}`);
    load.then(({ artist }) => {
      const next = { ...emptyArtist };
      for (const k of Object.keys(emptyArtist) as (keyof typeof emptyArtist)[]) {
        if (artist[k] !== undefined && artist[k] !== null) (next as Record<string, unknown>)[k] = artist[k];
      }
      next.genreSlugs = artist.genres.map((g) => g.slug);
      next.regionSlug = artist.region?.slug ?? '';
      setForm(next);
      setInitial(next);
      setLoaded(true);
    });
  }, [id, studio]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (studio) {
      const pick = (f: typeof form) => Object.fromEntries(STUDIO_ARTIST_FIELDS.map((k) => [k, f[k]]));
      const body: Record<string, unknown> = changedOnly(pick(initial), pick(form));
      if (!Object.keys(body).length) return onDone(undefined);
      if ('regionSlug' in body) body.regionSlug = form.regionSlug || null;
      run(() => api('/studio/profile', { method: 'PATCH', body }));
      return;
    }
    const body = { ...form, spotifyId: form.spotifyId ? spotifyId(form.spotifyId) : '', slug: form.slug || undefined, regionSlug: form.regionSlug || null };
    run(() => api(id ? `/admin/artists/${id}` : '/admin/artists', { method: id ? 'PATCH' : 'POST', body }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name *">
          <input className="input" value={form.name} onChange={set('name')} required />
        </Field>
        <Field label="@handle" hint="Instagram username, else stage_name. Leave empty for automatic.">
          <input
            className="input font-mono"
            placeholder={`@${toHandle(form.name) || 'stage_name'}`}
            value={form.handle ? `@${form.handle}` : ''}
            onChange={(e) => setForm({ ...form, handle: typingHandle(e.target.value) })}
          />
        </Field>
        <Field label="Real name">
          <input className="input" value={form.realName} onChange={set('realName')} />
        </Field>
        {!studio && (
          <Field label="Slug" hint="Leave blank to generate from name">
            <input className="input" value={form.slug} onChange={set('slug')} />
          </Field>
        )}
        <Field label="Active since">
          <input className="input" type="number" min={1970} max={2100} value={form.activeSince} onChange={set('activeSince')} />
        </Field>
      </div>
      <Field label="Bio">
        <textarea className="input min-h-28" value={form.bio} onChange={set('bio')} />
      </Field>
      <ArtistImageField
        artistName={form.name}
        wikipedia={!studio}
        value={{ imageUrl: form.imageUrl, imageCredit: form.imageCredit, imageSourceUrl: form.imageSourceUrl }}
        onChange={(img) => setForm({ ...form, ...img })}
      />
      <Field label="Banner URL">
        <input className="input" type="url" value={form.bannerUrl} onChange={set('bannerUrl')} />
      </Field>
      <Field label="City / region" hint={studio ? 'City not listed? Tell us through "Something missing?".' : 'Not listed? Pick “+ Add a new city” at the bottom.'}>
        <CityPicker value={form.regionSlug} onChange={(regionSlug) => setForm({ ...form, regionSlug })} allowCreate={!studio} />
      </Field>
      <Field label="Genres">
        <MultiChips
          options={genres.data?.items.map((g) => ({ value: g.slug, label: g.name })) ?? []}
          value={form.genreSlugs}
          onChange={(genreSlugs) => setForm({ ...form, genreSlugs })}
        />
      </Field>
      {!studio && (
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /> Verified
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Featured on home
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isProducer} onChange={(e) => setForm({ ...form, isProducer: e.target.checked })} /> Producer / beat maker
          </label>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spotify profile URL">
          <input className="input" type="url" value={form.spotifyUrl} onChange={set('spotifyUrl')} />
        </Field>
        {!studio && (
          <Field label="Spotify artist ID" hint="Paste the URL or ID - used by the future importer">
            <input className="input" value={form.spotifyId} onChange={set('spotifyId')} />
          </Field>
        )}
        <Field label="YouTube URL">
          <input className="input" type="url" value={form.youtubeUrl} onChange={set('youtubeUrl')} />
        </Field>
        <Field label="Instagram" hint="@handle or profile link">
          <input className="input" placeholder="@handle" value={form.instagramUrl} onChange={set('instagramUrl')} />
        </Field>
      </div>
      <FormActions busy={busy} error={error} onCancel={() => onDone(undefined)} />
    </form>
  );
}

// ---------- Album form ----------

const albumTypes: AlbumType[] = ['ALBUM', 'EP', 'MIXTAPE', 'SINGLE'];

/** Same @handle search as song credits: type a name or @handle, or create someone new. */
function ArtistPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [picked, setPicked] = useState<HandleRef | null>(null);
  // Editing an existing album/song: look up the artist behind the stored id once.
  const { data } = useQuery({
    queryKey: ['admin', 'artist', value],
    queryFn: () => api<{ artist: HandleRef }>(`/admin/artists/${value}`),
    enabled: !!value && picked?.id !== value,
  });
  const current = picked?.id === value ? picked : value ? (data?.artist ?? null) : null;

  return (
    <HandleInput
      value={current ? [current] : []}
      onChange={(list) => {
        const next = list[list.length - 1] ?? null; // one artist only
        setPicked(next);
        onChange(next?.id ?? '');
      }}
      placeholder="Type a name or @handle…"
    />
  );
}

export function AlbumForm({ id, onDone, studio }: { id: string | null; onDone: (result: SubmitResult) => void; studio?: StudioScope }) {
  const blank = { title: '', slug: '', artistId: studio?.artistId ?? '', type: 'ALBUM' as AlbumType, releaseDate: '', coverUrl: '', spotifyId: '' };
  const [form, setForm] = useState(blank);
  const [initial, setInitial] = useState(blank);
  const [loaded, setLoaded] = useState(!id);
  const { error, busy, run, setError } = useSubmit(onDone);
  const base = studio ? '/studio' : '/admin';

  useEffect(() => {
    if (!id) return;
    api<{ album: typeof form & { releaseDate: string | null; coverUrl: string | null; spotifyId: string | null } }>(`${base}/albums/${id}`).then(({ album }) => {
      const next = {
        title: album.title,
        slug: album.slug,
        artistId: album.artistId,
        type: album.type,
        releaseDate: dateInput(album.releaseDate),
        coverUrl: album.coverUrl ?? '',
        spotifyId: album.spotifyId ?? '',
      };
      setForm(next);
      setInitial(next);
      setLoaded(true);
    });
  }, [id, base]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.artistId) return setError('Pick the artist this release belongs to');
    const clean = (f: typeof form) => ({ ...f, slug: f.slug || undefined, spotifyId: f.spotifyId ? spotifyId(f.spotifyId) : '' });
    if (studio) {
      // The owning artist and slug are implied on the server.
      const strip = ({ artistId: _a, slug: _s, ...rest }: ReturnType<typeof clean>) => rest;
      const body = id ? changedOnly(strip(clean(initial)), strip(clean(form))) : strip(clean(form));
      if (id && !Object.keys(body).length) return onDone(undefined);
      run(() => api(id ? `/studio/albums/${id}` : '/studio/albums', { method: id ? 'PATCH' : 'POST', body }));
      return;
    }
    run(() => api(id ? `/admin/albums/${id}` : '/admin/albums', { method: id ? 'PATCH' : 'POST', body: clean(form) }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title *">
        <input className="input" value={form.title} onChange={set('title')} required />
      </Field>
      {!studio && (
        <Field label="Artist *">
          <ArtistPicker value={form.artistId} onChange={(artistId) => setForm({ ...form, artistId })} />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type">
          <select className="input" value={form.type} onChange={set('type')}>
            {albumTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Release date">
          <input className="input" type="date" value={form.releaseDate} onChange={set('releaseDate')} />
        </Field>
        <Field label="Cover URL">
          <input className="input" type="url" value={form.coverUrl} onChange={set('coverUrl')} />
        </Field>
        {!studio && (
          <Field label="Slug" hint="Leave blank to generate">
            <input className="input" value={form.slug} onChange={set('slug')} />
          </Field>
        )}
      </div>
      <Field label="Spotify album" hint="Paste the album URL or ID">
        <input className="input" value={form.spotifyId} onChange={set('spotifyId')} />
      </Field>
      <FormActions busy={busy} error={error} onCancel={() => onDone(undefined)} />
    </form>
  );
}

// ---------- Song form ----------

const emptySong = {
  title: '',
  slug: '',
  artistId: '',
  albumId: '',
  trackNumber: '' as string | number,
  releaseDate: '',
  durationSec: '' as string | number,
  coverUrl: '',
  explicit: false,
  genreSlugs: [] as string[],
  features: [] as HandleRef[],
  producers: [] as HandleRef[],
  spotifyTrackId: '',
  youtubeVideoId: '',
  lyricsUrl: '',
};

export function SongForm({ id, onDone, studio }: { id: string | null; onDone: (result: SubmitResult) => void; studio?: StudioScope }) {
  const genres = useGenres();
  const blank = { ...emptySong, artistId: studio?.artistId ?? '' };
  const [form, setForm] = useState(blank);
  const [initial, setInitial] = useState(blank);
  const [loaded, setLoaded] = useState(!id);
  const { error, busy, run, setError } = useSubmit(onDone);
  const base = studio ? '/studio' : '/admin';
  const albums = useQuery({
    queryKey: [studio ? 'studio' : 'admin', 'albums', form.artistId],
    queryFn: () =>
      studio
        ? api<{ items: AlbumCard[] }>('/studio/albums')
        : api<{ items: AlbumCard[] }>('/admin/albums', { query: { artistId: form.artistId } }),
    enabled: !!form.artistId,
  });

  useEffect(() => {
    if (!id) return;
    type Raw = Record<string, unknown> & {
      genres: { slug: string }[];
      features: { artist: HandleRef }[];
      producers: { artist: HandleRef }[];
      releaseDate: string | null;
    };
    api<{ song: Raw }>(`${base}/songs/${id}`).then(({ song }) => {
      const next = { ...emptySong };
      for (const k of Object.keys(emptySong) as (keyof typeof emptySong)[]) {
        if (song[k] !== undefined && song[k] !== null) (next as Record<string, unknown>)[k] = song[k];
      }
      next.releaseDate = dateInput(song.releaseDate);
      next.genreSlugs = song.genres.map((g) => g.slug);
      next.features = song.features.map((f) => f.artist);
      next.producers = song.producers.map((p) => p.artist);
      setForm(next);
      setInitial(next);
      setLoaded(true);
    });
  }, [id, base]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const toBody = (f: typeof form) => {
    const { features, producers, ...rest } = f;
    return {
      ...rest,
      slug: f.slug || undefined,
      spotifyTrackId: f.spotifyTrackId ? spotifyId(f.spotifyTrackId) : '',
      youtubeVideoId: f.youtubeVideoId ? youtubeId(f.youtubeVideoId) : '',
      featureArtistIds: features.map((a) => a.id).filter((a) => a !== f.artistId),
      producerArtistIds: producers.map((a) => a.id),
    };
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.artistId) return setError('Pick the primary artist');
    if (studio) {
      const strip = ({ artistId: _a, slug: _s, ...rest }: ReturnType<typeof toBody>) => rest;
      const body = id ? changedOnly(strip(toBody(initial)), strip(toBody(form))) : strip(toBody(form));
      if (id && !Object.keys(body).length) return onDone(undefined);
      run(() => api(id ? `/studio/songs/${id}` : '/studio/songs', { method: id ? 'PATCH' : 'POST', body }));
      return;
    }
    run(() => api(id ? `/admin/songs/${id}` : '/admin/songs', { method: id ? 'PATCH' : 'POST', body: toBody(form) }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title *">
        <input className="input" value={form.title} onChange={set('title')} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {!studio && (
          <Field label="Primary artist *">
            <ArtistPicker value={form.artistId} onChange={(artistId) => setForm({ ...form, artistId, albumId: '' })} />
          </Field>
        )}
        <Field label="Album / release">
          <select className="input" value={form.albumId} onChange={set('albumId')} disabled={!form.artistId}>
            <option value="">Single (no album)</option>
            {albums.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} {year(a.releaseDate) ? `(${year(a.releaseDate)})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Track #">
          <input className="input" type="number" min={1} value={form.trackNumber} onChange={set('trackNumber')} />
        </Field>
        <Field label="Release date">
          <input className="input" type="date" value={form.releaseDate} onChange={set('releaseDate')} />
        </Field>
        <Field label="Duration (seconds)">
          <input className="input" type="number" min={1} value={form.durationSec} onChange={set('durationSec')} />
        </Field>
        <Field label="Cover URL" hint="Falls back to the album cover">
          <input className="input" type="url" value={form.coverUrl} onChange={set('coverUrl')} />
        </Field>
      </div>
      <Field label="Genres">
        <MultiChips
          options={genres.data?.items.map((g) => ({ value: g.slug, label: g.name })) ?? []}
          value={form.genreSlugs}
          onChange={(genreSlugs) => setForm({ ...form, genreSlugs })}
        />
      </Field>
      <Field label="Featured artists" hint={studio ? 'Type their @handle. Not on DHH/CULTURE yet? Tell us through "Something missing?".' : 'Type @handle. Unknown handles can be created here.'}>
        <HandleInput
          value={form.features}
          onChange={(features) => setForm({ ...form, features })}
          excludeIds={form.artistId ? [form.artistId] : []}
          allowCreate={!studio}
          placeholder="@artist ft. on this track…"
        />
      </Field>
      <Field label="Produced by" hint="Beat makers. Shown as 'Prod. @handle'.">
        <HandleInput
          value={form.producers}
          onChange={(producers) => setForm({ ...form, producers })}
          createAsProducer
          allowCreate={!studio}
          placeholder="@producer…"
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spotify track" hint="Paste the track URL or ID to enable the embed">
          <input className="input" value={form.spotifyTrackId} onChange={set('spotifyTrackId')} />
        </Field>
        <Field label="YouTube video" hint="Paste the video URL or ID">
          <input className="input" value={form.youtubeVideoId} onChange={set('youtubeVideoId')} />
        </Field>
        <Field label="Lyrics URL">
          <input className="input" type="url" value={form.lyricsUrl} onChange={set('lyricsUrl')} />
        </Field>
        {!studio && (
          <Field label="Slug" hint="Leave blank to generate">
            <input className="input" value={form.slug} onChange={set('slug')} />
          </Field>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.explicit} onChange={(e) => setForm({ ...form, explicit: e.target.checked })} /> Explicit
      </label>
      <FormActions busy={busy} error={error} onCancel={() => onDone(undefined)} />
    </form>
  );
}
