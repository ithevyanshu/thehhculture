import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useArtists, useGenres, useRegions, useSongs } from '../../lib/queries';
import { at, toHandle, typingHandle, year } from '../../lib/format';
import { Artwork } from '../../components/Artwork';
import { Pagination, Spinner } from '../../components/ui';
import type { AlbumCard, AlbumType } from '../../lib/types';
import { FrontPageAdmin } from './FrontPageAdmin';
import { HandleInput, type HandleRef } from '../../components/HandleInput';
import { InstagramGlyph, instagramHandle } from '../../components/Instagram';
import { UsersAdmin } from './UsersAdmin';
import { SuggestionsAdmin } from './SuggestionsAdmin';
import { ShowsAdmin } from './ShowsAdmin';
import { useDialog } from '../../components/Dialog';
import { Link } from 'react-router-dom';

type Tab = 'Overview' | 'Front page' | 'Artists' | 'Albums' | 'Songs' | 'Shows' | 'Taxonomy' | 'Suggestions' | 'Users';
type Editing = { kind: 'artist' | 'album' | 'song'; id: string | null } | null;

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

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

function useSubmit(onDone: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        const details = err.details ? Object.entries(err.details).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' · ') : '';
        setError(details ? `${err.message} - ${details}` : err.message);
      } else setError('Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run };
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

function ArtistImageField({ artistName, value, onChange }: { artistName: string; value: ArtistImage; onChange: (v: ArtistImage) => void }) {
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
    </div>
  );
}

// ---------- City picker with inline "add new city" ----------

const NEW_CITY = '__new__';

function CityPicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
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
        <option value={NEW_CITY}>+ Add a new city…</option>
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

function ArtistForm({ id, onDone }: { id: string | null; onDone: () => void }) {
  const genres = useGenres();
  const [form, setForm] = useState(emptyArtist);
  const [loaded, setLoaded] = useState(!id);
  const { error, busy, run } = useSubmit(onDone);

  useEffect(() => {
    if (!id) return;
    api<{ artist: Record<string, unknown> & { genres: { slug: string }[]; region: { slug: string } | null } }>(`/admin/artists/${id}`).then(({ artist }) => {
      const next = { ...emptyArtist };
      for (const k of Object.keys(emptyArtist) as (keyof typeof emptyArtist)[]) {
        if (artist[k] !== undefined && artist[k] !== null) (next as Record<string, unknown>)[k] = artist[k];
      }
      next.genreSlugs = artist.genres.map((g) => g.slug);
      next.regionSlug = artist.region?.slug ?? '';
      setForm(next);
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
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
        <Field label="Slug" hint="Leave blank to generate from name">
          <input className="input" value={form.slug} onChange={set('slug')} />
        </Field>
        <Field label="Active since">
          <input className="input" type="number" min={1970} max={2100} value={form.activeSince} onChange={set('activeSince')} />
        </Field>
      </div>
      <Field label="Bio">
        <textarea className="input min-h-28" value={form.bio} onChange={set('bio')} />
      </Field>
      <ArtistImageField
        artistName={form.name}
        value={{ imageUrl: form.imageUrl, imageCredit: form.imageCredit, imageSourceUrl: form.imageSourceUrl }}
        onChange={(img) => setForm({ ...form, ...img })}
      />
      <Field label="Banner URL">
        <input className="input" type="url" value={form.bannerUrl} onChange={set('bannerUrl')} />
      </Field>
      <Field label="City / region" hint="Not listed? Pick “+ Add a new city” at the bottom.">
        <CityPicker value={form.regionSlug} onChange={(regionSlug) => setForm({ ...form, regionSlug })} />
      </Field>
      <Field label="Genres">
        <MultiChips
          options={genres.data?.items.map((g) => ({ value: g.slug, label: g.name })) ?? []}
          value={form.genreSlugs}
          onChange={(genreSlugs) => setForm({ ...form, genreSlugs })}
        />
      </Field>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Spotify profile URL">
          <input className="input" type="url" value={form.spotifyUrl} onChange={set('spotifyUrl')} />
        </Field>
        <Field label="Spotify artist ID" hint="Paste the URL or ID - used by the future importer">
          <input className="input" value={form.spotifyId} onChange={set('spotifyId')} />
        </Field>
        <Field label="YouTube URL">
          <input className="input" type="url" value={form.youtubeUrl} onChange={set('youtubeUrl')} />
        </Field>
        <Field label="Instagram" hint="@handle or profile link">
          <input className="input" placeholder="@handle" value={form.instagramUrl} onChange={set('instagramUrl')} />
        </Field>
      </div>
      <FormActions busy={busy} error={error} onCancel={onDone} />
    </form>
  );
}

// ---------- Album form ----------

const albumTypes: AlbumType[] = ['ALBUM', 'EP', 'MIXTAPE', 'SINGLE'];

function ArtistSelect({ value, onChange, required }: { value: string; onChange: (v: string) => void; required?: boolean }) {
  const artists = useArtists({ sort: 'name', limit: 100 });
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">Select artist…</option>
      {artists.data?.items.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}

function AlbumForm({ id, onDone }: { id: string | null; onDone: () => void }) {
  const [form, setForm] = useState({ title: '', slug: '', artistId: '', type: 'ALBUM' as AlbumType, releaseDate: '', coverUrl: '', spotifyId: '' });
  const [loaded, setLoaded] = useState(!id);
  const { error, busy, run } = useSubmit(onDone);

  useEffect(() => {
    if (!id) return;
    api<{ album: typeof form & { releaseDate: string | null; coverUrl: string | null; spotifyId: string | null } }>(`/admin/albums/${id}`).then(({ album }) => {
      setForm({
        title: album.title,
        slug: album.slug,
        artistId: album.artistId,
        type: album.type,
        releaseDate: dateInput(album.releaseDate),
        coverUrl: album.coverUrl ?? '',
        spotifyId: album.spotifyId ?? '',
      });
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body = { ...form, slug: form.slug || undefined, spotifyId: form.spotifyId ? spotifyId(form.spotifyId) : '' };
    run(() => api(id ? `/admin/albums/${id}` : '/admin/albums', { method: id ? 'PATCH' : 'POST', body }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title *">
        <input className="input" value={form.title} onChange={set('title')} required />
      </Field>
      <Field label="Artist *">
        <ArtistSelect value={form.artistId} onChange={(artistId) => setForm({ ...form, artistId })} required />
      </Field>
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
        <Field label="Slug" hint="Leave blank to generate">
          <input className="input" value={form.slug} onChange={set('slug')} />
        </Field>
      </div>
      <Field label="Spotify album ID" hint="Paste the URL or ID">
        <input className="input" value={form.spotifyId} onChange={set('spotifyId')} />
      </Field>
      <FormActions busy={busy} error={error} onCancel={onDone} />
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

function SongForm({ id, onDone }: { id: string | null; onDone: () => void }) {
  const genres = useGenres();
  const [form, setForm] = useState(emptySong);
  const [loaded, setLoaded] = useState(!id);
  const { error, busy, run } = useSubmit(onDone);
  const albums = useQuery({
    queryKey: ['admin', 'albums', form.artistId],
    queryFn: () => api<{ items: AlbumCard[] }>('/admin/albums', { query: { artistId: form.artistId } }),
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
    api<{ song: Raw }>(`/admin/songs/${id}`).then(({ song }) => {
      const next = { ...emptySong };
      for (const k of Object.keys(emptySong) as (keyof typeof emptySong)[]) {
        if (song[k] !== undefined && song[k] !== null) (next as Record<string, unknown>)[k] = song[k];
      }
      next.releaseDate = dateInput(song.releaseDate);
      next.genreSlugs = song.genres.map((g) => g.slug);
      next.features = song.features.map((f) => f.artist);
      next.producers = song.producers.map((p) => p.artist);
      setForm(next);
      setLoaded(true);
    });
  }, [id]);

  if (!loaded) return <Spinner />;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { features, producers, ...rest } = form;
    const body = {
      ...rest,
      slug: form.slug || undefined,
      spotifyTrackId: form.spotifyTrackId ? spotifyId(form.spotifyTrackId) : '',
      youtubeVideoId: form.youtubeVideoId ? youtubeId(form.youtubeVideoId) : '',
      featureArtistIds: features.map((a) => a.id).filter((a) => a !== form.artistId),
      producerArtistIds: producers.map((a) => a.id),
    };
    run(() => api(id ? `/admin/songs/${id}` : '/admin/songs', { method: id ? 'PATCH' : 'POST', body }));
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title *">
        <input className="input" value={form.title} onChange={set('title')} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary artist *">
          <ArtistSelect value={form.artistId} onChange={(artistId) => setForm({ ...form, artistId, albumId: '' })} required />
        </Field>
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
      <Field label="Featured artists" hint="Type @handle. Unknown handles can be created here.">
        <HandleInput
          value={form.features}
          onChange={(features) => setForm({ ...form, features })}
          excludeIds={form.artistId ? [form.artistId] : []}
          placeholder="@artist ft. on this track…"
        />
      </Field>
      <Field label="Produced by" hint="Beat makers. Shown as 'Prod. @handle'. New handles are created as producers.">
        <HandleInput
          value={form.producers}
          onChange={(producers) => setForm({ ...form, producers })}
          createAsProducer
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
        <Field label="Slug" hint="Leave blank to generate">
          <input className="input" value={form.slug} onChange={set('slug')} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.explicit} onChange={(e) => setForm({ ...form, explicit: e.target.checked })} /> Explicit
      </label>
      <FormActions busy={busy} error={error} onCancel={onDone} />
    </form>
  );
}

// ---------- Lists ----------

function Row({ image, title, subtitle, onEdit, onDelete }: { image: ReactNode; title: string; subtitle: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-none px-2 py-2 hover:bg-ink/5">
      <div className="size-10 shrink-0">{image}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <button onClick={onEdit} className="rounded-full p-2 text-muted hover:bg-ink/10 hover:text-bone" aria-label={`Edit ${title}`}>
        <Pencil size={16} />
      </button>
      <button onClick={onDelete} className="rounded-full p-2 text-muted hover:bg-ink/10 hover:text-pink" aria-label={`Delete ${title}`}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function ListShell({
  q,
  setQ,
  onNew,
  newLabel,
  actions,
  children,
}: {
  q: string;
  setQ: (v: string) => void;
  onNew: () => void;
  newLabel: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input !w-72" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={onNew} className="btn-primary">
          <Plus size={16} /> {newLabel}
        </button>
        {actions}
      </div>
      <div className="border-2 border-ink bg-surface px-1 shadow-hard">{children}</div>
    </div>
  );
}

function useDelete() {
  const qc = useQueryClient();
  const dialog = useDialog();
  return async (path: string, name: string) => {
    if (!(await dialog.confirm(`Delete "${name}"? This cannot be undone.`))) return;
    try {
      await api(path, { method: 'DELETE' });
      qc.invalidateQueries();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : 'Delete failed', 'Could not delete');
    }
  };
}

function ArtistsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useArtists({ q, sort: 'name', page, limit: 50 });
  const del = useDelete();
  const qc = useQueryClient();
  const dialog = useDialog();
  type Job = 'photos' | 'instagram';
  const [fetching, setFetching] = useState<Job | null>(null);
  const [report, setReport] = useState<{ job: Job; results: { artist: string; status: string; pageTitle?: string; handle?: string }[] } | null>(null);

  const runJob = async (job: Job) => {
    setFetching(job);
    setReport(null);
    try {
      const { results } = await api<{ results: { artist: string; status: string; pageTitle?: string; handle?: string }[] }>(
        job === 'photos' ? '/admin/artists/images/fetch' : '/admin/artists/instagram/fetch',
        { method: 'POST', body: { overwrite: false } },
      );
      setReport({ job, results });
      qc.invalidateQueries();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : 'Lookup failed', 'Lookup failed');
    } finally {
      setFetching(null);
    }
  };

  return (
    <ListShell
      q={q}
      setQ={(v) => (setQ(v), setPage(1))}
      onNew={() => edit(null)}
      newLabel="New artist"
      actions={
        <>
          <button onClick={() => runJob('photos')} className="btn-ghost" disabled={!!fetching} title="Match artists without a photo to their Wikipedia page">
            {fetching === 'photos' ? 'Fetching photos…' : 'Fetch missing photos'}
          </button>
          <button onClick={() => runJob('instagram')} className="btn-ghost" disabled={!!fetching} title="Look up official Instagram handles on Wikidata">
            <InstagramGlyph size={14} /> {fetching === 'instagram' ? 'Looking up…' : 'Fetch Instagram'}
          </button>
        </>
      }
    >
      {report && (
        <div className="mb-2 border-2 border-ink bg-surface p-3 text-sm shadow-hard-sm">
          {report.results.length === 0 ? (
            <p className="text-muted">Every artist already has {report.job === 'photos' ? 'a photo' : 'an Instagram link'}.</p>
          ) : (
            <>
              <p className="mb-1 font-semibold">
                Updated {report.results.filter((r) => r.status === 'updated').length} of {report.results.length}
                {report.job === 'instagram' &&
                  report.results.some((r) => r.handle) &&
                  `: ${report.results.flatMap((r) => (r.handle ? [`@${r.handle}`] : [])).join(', ')}`}
              </p>
              {report.results
                .filter((r) => r.status !== 'updated')
                .map((r) => (
                  <p key={r.artist} className="text-muted">
                    {r.artist}:{' '}
                    {r.status !== 'not-found'
                      ? 'lookup failed'
                      : report.job === 'photos'
                        ? 'no confident Wikipedia match, so set it manually'
                        : 'no handle on Wikidata, so add it in the artist form'}
                  </p>
                ))}
            </>
          )}
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((a) => (
          <Row
            key={a.id}
            image={<Artwork src={a.imageUrl} name={a.name} seed={a.slug} round />}
            title={a.name}
            subtitle={[
              a.region?.name,
              `${a._count.songs} songs`,
              `${a._count.followers} followers`,
              at(a),
              a.instagramUrl ? `IG @${instagramHandle(a.instagramUrl)}` : 'no Instagram',
            ]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => edit(a.id)}
            onDelete={() => del(`/admin/artists/${a.id}`, a.name)}
          />
        ))
      )}
      {data && <Pagination meta={data.meta} onPage={setPage} />}
    </ListShell>
  );
}

function AlbumsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['admin', 'albums', 'list', q], queryFn: () => api<{ items: AlbumCard[] }>('/admin/albums', { query: { q } }) });
  const del = useDelete();
  return (
    <ListShell q={q} setQ={setQ} onNew={() => edit(null)} newLabel="New album">
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((a) => (
          <Row
            key={a.id}
            image={<Artwork src={a.coverUrl} name={a.title} seed={a.slug} className="!rounded-none" />}
            title={a.title}
            subtitle={[a.artist.name, a.type, year(a.releaseDate), `${a._count.songs} tracks`].filter(Boolean).join(' · ')}
            onEdit={() => edit(a.id)}
            onDelete={() => del(`/admin/albums/${a.id}`, a.title)}
          />
        ))
      )}
    </ListShell>
  );
}

function SongsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useSongs({ q, sort: 'new', page, limit: 50 });
  const del = useDelete();
  return (
    <ListShell q={q} setQ={(v) => (setQ(v), setPage(1))} onNew={() => edit(null)} newLabel="New song">
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((s) => (
          <Row
            key={s.id}
            image={<Artwork src={s.coverUrl ?? s.album?.coverUrl} name={s.title} seed={s.slug} className="!rounded-none" />}
            title={s.title}
            subtitle={[
              s.artist.name,
              s.album?.title ?? 'Single',
              year(s.releaseDate),
              s.spotifyTrackId || s.youtubeVideoId ? '▶ embed' : 'no embed',
            ]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => edit(s.id)}
            onDelete={() => del(`/admin/songs/${s.id}`, s.title)}
          />
        ))
      )}
      {data && <Pagination meta={data.meta} onPage={setPage} />}
    </ListShell>
  );
}

function TaxonomyAdmin() {
  const genres = useGenres();
  const regions = useRegions();
  const qc = useQueryClient();
  const del = useDelete();
  const [genre, setGenre] = useState('');
  const [region, setRegion] = useState({ name: '', state: '' });

  const addGenre = async (e: FormEvent) => {
    e.preventDefault();
    await api('/admin/genres', { method: 'POST', body: { name: genre } });
    setGenre('');
    qc.invalidateQueries({ queryKey: ['genres'] });
  };
  const addRegion = async (e: FormEvent) => {
    e.preventDefault();
    await api('/admin/regions', { method: 'POST', body: region });
    setRegion({ name: '', state: '' });
    qc.invalidateQueries({ queryKey: ['regions'] });
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h3 className="display mb-3 text-2xl">Genres</h3>
        <form onSubmit={addGenre} className="mb-3 flex gap-2">
          <input className="input" placeholder="New genre" value={genre} onChange={(e) => setGenre(e.target.value)} required />
          <button className="btn-primary">Add</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {genres.data?.items.map((g) => (
            <span key={g.id} className="chip">
              {g.name} ({g._count?.songs ?? 0})
              <button onClick={() => del(`/admin/genres/${g.id}`, g.name)} aria-label={`Delete ${g.name}`} className="hover:text-pink">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </section>
      <section>
        <h3 className="display mb-3 text-2xl">Cities / regions</h3>
        <form onSubmit={addRegion} className="mb-3 flex gap-2">
          <input className="input" placeholder="City" value={region.name} onChange={(e) => setRegion({ ...region, name: e.target.value })} required />
          <input className="input" placeholder="State" value={region.state} onChange={(e) => setRegion({ ...region, state: e.target.value })} />
          <button className="btn-primary">Add</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {regions.data?.items.map((r) => (
            <span key={r.id} className="chip">
              {r.name} ({r._count?.artists ?? 0})
              <button onClick={() => del(`/admin/regions/${r.id}`, r.name)} aria-label={`Delete ${r.name}`} className="hover:text-pink">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

interface AdminStats {
  counts: Record<string, number>;
  newSuggestions: number;
  views: { week: number; allTime: number };
  topArtists: {
    week: { id: string; slug: string; name: string; imageUrl: string | null; week: number; allTime: number }[];
    allTime: { id: string; slug: string; name: string; imageUrl: string | null; week: number; allTime: number }[];
  };
}

function TopArtistList({ title, items, metric }: { title: string; items: AdminStats['topArtists']['week']; metric: 'week' | 'allTime' }) {
  return (
    <section className="border-2 border-ink bg-surface shadow-hard">
      <h3 className="display border-b-2 border-ink bg-paper px-4 py-2 text-2xl">{title}</h3>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No profile clicks yet.</p>
      ) : (
        <ol>
          {items.map((a, i) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-dashed border-ink/25 px-4 py-2 last:border-b-0">
              <span className="display w-7 text-2xl">{String(i + 1).padStart(2, '0')}</span>
              <div className="size-9 shrink-0 border border-ink">
                <Artwork src={a.imageUrl} name={a.name} seed={a.slug} live />
              </div>
              <Link to={`/artists/${a.slug}`} className="flex-1 truncate font-bold uppercase hover:underline">
                {a.name}
              </Link>
              <span className="mono">{a[metric].toLocaleString('en-IN')} clicks</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Overview({ openSuggestions }: { openSuggestions: () => void }) {
  const { data } = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/admin/stats') });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-8">
      {data.newSuggestions > 0 && (
        <button onClick={openSuggestions} className="flex w-full items-center justify-between border-2 border-ink bg-neon p-4 text-left shadow-hard">
          <span className="display text-2xl">
            {data.newSuggestions} new suggestion{data.newSuggestions === 1 ? '' : 's'} waiting
          </span>
          <span className="mono">Open inbox →</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Profile clicks (7d)', data.views.week],
          ['Profile clicks (all time)', data.views.allTime],
          ...Object.entries(data.counts),
        ].map(([k, v]) => (
          <div key={k} className="border-2 border-ink bg-surface p-5 shadow-hard-sm">
            <p className="display text-4xl text-saffron">{Number(v).toLocaleString('en-IN')}</p>
            <p className="mono mt-1 text-muted">{k}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <TopArtistList title="Top artists · this week" items={data.topArtists.week} metric="week" />
        <TopArtistList title="Top artists · all time" items={data.topArtists.allTime} metric="allTime" />
      </div>
    </div>
  );
}

// ---------- Page ----------

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState<Editing>(null);
  const qc = useQueryClient();

  const close = () => {
    setEditing(null);
    qc.invalidateQueries();
  };

  const tabs: Tab[] = ['Overview', 'Front page', 'Artists', 'Albums', 'Songs', 'Shows', 'Taxonomy', 'Suggestions', 'Users'];

  return (
    <div className="mx-auto max-w-6xl">
      <span className="sticker">Admin</span>
      <h1 className="display mt-3 mb-6 text-5xl md:text-7xl">Catalog control</h1>
      <div className="scrollbar-none mb-8 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip shrink-0 !px-4 !py-2 !text-sm ${tab === t ? 'chip-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview openSuggestions={() => setTab('Suggestions')} />}
      {tab === 'Suggestions' && <SuggestionsAdmin />}
      {tab === 'Shows' && <ShowsAdmin />}
      {tab === 'Artists' && <ArtistsAdmin edit={(id) => setEditing({ kind: 'artist', id })} />}
      {tab === 'Albums' && <AlbumsAdmin edit={(id) => setEditing({ kind: 'album', id })} />}
      {tab === 'Songs' && <SongsAdmin edit={(id) => setEditing({ kind: 'song', id })} />}
      {tab === 'Taxonomy' && <TaxonomyAdmin />}
      {tab === 'Front page' && <FrontPageAdmin />}
      {tab === 'Users' && <UsersAdmin />}

      {editing && (
        <Drawer title={`${editing.id ? 'Edit' : 'New'} ${editing.kind}`} onClose={() => setEditing(null)}>
          {editing.kind === 'artist' && <ArtistForm id={editing.id} onDone={close} />}
          {editing.kind === 'album' && <AlbumForm id={editing.id} onDone={close} />}
          {editing.kind === 'song' && <SongForm id={editing.id} onDone={close} />}
        </Drawer>
      )}
    </div>
  );
}
