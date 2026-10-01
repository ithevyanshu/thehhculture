import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock, Eye, EyeOff, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useArtists, useGenres, useRegions, useShows, useSongs } from '../../lib/queries';
import { Artwork } from '../../components/Artwork';
import { Spinner } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import type { AlbumCard, Tone } from '../../lib/types';

// ---------- Types mirroring backend/src/modules/site/config.ts ----------

interface ArtistSlide {
  type: 'artist';
  artistId: string | null; // null only while the editor hasn't picked yet
  songId: string | null;
  kicker: string | null;
  blurb: string | null;
  startsAt: string | null;
  endsAt: string | null;
}
interface NewsSlide {
  type: 'news';
  kicker: string | null;
  headline: string;
  body: string | null;
  /** Set to give the story its own page at /story/<slug>. */
  slug: string | null;
  /** The full piece shown on that page; `body` stays the carousel teaser. */
  article: string | null;
  /** Admin opt-in: visitors get the share button too. */
  shareable: boolean;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  artistIds: string[];
  startsAt: string | null;
  endsAt: string | null;
}
type CoverSlide = ArtistSlide | NewsSlide;
interface CoverStory {
  mode: 'auto' | 'manual' | 'hidden';
  slides: CoverSlide[];
  autoFill: boolean;
  intervalSeconds: number;
  forceForEveryone: boolean;
}
interface Announcement {
  enabled: boolean;
  text: string;
  linkUrl: string | null;
  linkLabel: string | null;
  tone: Tone;
  expiresAt: string | null;
}
type TickerItem =
  | { type: 'song'; songId: string }
  | { type: 'artist'; artistId: string }
  | { type: 'show'; showId: string }
  | { type: 'text'; text: string; linkUrl: string | null };
interface Ticker {
  mode: 'auto' | 'manual' | 'hidden';
  label: string;
  items: TickerItem[];
  auto: { count: number; withinDays: number | null; genreSlugs: string[]; regionSlugs: string[] };
  speed: 'slow' | 'normal' | 'fast';
  tone: Tone;
}
interface SectionItem {
  key: string;
  visible: boolean;
  title: string | null;
  subtitle: string | null;
  /** Releases ids are tagged: "song:<id>" or "album:<id>". Artists stay bare ids. */
  custom?: { kind: 'releases' | 'artists'; ids: string[] };
}
interface Chart {
  title: string | null;
  subtitle: string | null;
  size: number;
  pinnedSongIds: string[];
  excludedSongIds: string[];
  /** Empty = the whole catalog. */
  artistIds: string[];
  sort: 'likes' | 'new' | 'random';
  maxPerArtist: number;
}
interface AlbumRef {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  artistName: string;
}
interface SongRef {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  artistName: string;
}
interface ArtistRef {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
}
interface Issue {
  mode: 'auto' | 'manual';
  number: number;
  countUp: boolean;
  since: string | null;
}
interface SiteConfigResponse {
  config: { coverStory: CoverStory; announcement: Announcement; ticker: Ticker; sections: { items: SectionItem[] }; chart: Chart; issue: Issue };
  builtins: { key: string; label: string; audience: 'everyone' | 'signed-in' }[];
  refs: { songs: Record<string, SongRef>; artists: Record<string, ArtistRef>; albums: Record<string, AlbumRef> };
}

type Refs = SiteConfigResponse['refs'];

// ---------- helpers ----------

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function move<T>(list: T[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function useSaveSetting<T>(key: string) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (value: T) => api(`/admin/site-config/${key}`, { method: 'PUT', body: value }),
    onSuccess: () => {
      setStatus({ ok: true, msg: 'Saved. Live on the front page.' });
      qc.invalidateQueries({ queryKey: ['home'] });
      qc.invalidateQueries({ queryKey: ['site'] });
      qc.invalidateQueries({ queryKey: ['admin', 'site-config'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.details) {
        const details = Object.entries(err.details)
          .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
          .join(' · ');
        setStatus({ ok: false, msg: `${err.message} - ${details}` });
      } else setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Save failed' });
    },
  });
  return {
    save: (v: T) => {
      setStatus(null);
      mutation.mutate(v);
    },
    saving: mutation.isPending,
    status,
  };
}

// ---------- building blocks ----------

/** The panels, in page order, for the jump navigation at the top. */
const PANELS = [
  { id: 'cover-story', label: 'Cover story' },
  { id: 'layout', label: 'Layout' },
  { id: 'chart', label: 'The Chart' },
  { id: 'ticker', label: 'Ticker' },
  { id: 'announcement', label: 'Announcement' },
  { id: 'issue', label: 'Issue number' },
] as const;

/** Chips that jump to a panel and highlight whichever one you're looking at. */
function PanelNav() {
  const [active, setActive] = useState<string>(PANELS[0].id);
  useEffect(() => {
    const seen = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best?.[1]) setActive(best[0]);
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const p of PANELS) {
      const el = document.getElementById(p.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Front page settings" className="scrollbar-none sticky top-16 z-20 -mx-4 mb-8 flex gap-2 overflow-x-auto bg-paper/95 px-4 py-2 backdrop-blur-sm">
      {PANELS.map((p) => (
        <a key={p.id} href={`#${p.id}`} aria-current={active === p.id} className={`chip shrink-0 ${active === p.id ? 'chip-active' : ''}`}>
          {p.label}
        </a>
      ))}
    </nav>
  );
}

function Panel({
  id,
  title,
  description,
  children,
  onSave,
  saving,
  status,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
  status: { ok: boolean; msg: string } | null;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-28 border-2 border-ink bg-surface shadow-hard">
      <header className="border-b-2 border-ink bg-paper px-5 py-3">
        <h2 className="display text-3xl">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </header>
      <div className="space-y-5 p-5">{children}</div>
      <footer className="flex flex-wrap items-center gap-3 border-t-2 border-dashed border-ink/30 px-5 py-3">
        <button onClick={onSave} disabled={saving} className="btn-primary">
          {saving ? 'Saving…' : 'Save'}
        </button>
        {status && <p className={`text-sm ${status.ok ? 'text-saffron-soft' : 'text-red'}`}>{status.msg}</p>}
      </footer>
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap border-2 border-ink">
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`mono px-3 py-1.5 ${value === o.value ? 'bg-ink text-paper' : 'bg-surface hover:bg-neon'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dim">{hint}</span>}
    </div>
  );
}

/** A picked reference: artists are bare, releases say whether they're a song or an album. */
type PickRef = (SongRef | AlbumRef) & { type: 'song' | 'album' };

/** Type-ahead search. 'release' searches songs and albums together and labels each. */
function Picker({
  kind,
  onPick,
  placeholder,
  artistSlug,
}: {
  kind: 'song' | 'artist' | 'release';
  onPick: (ref: SongRef | ArtistRef | PickRef) => void;
  placeholder?: string;
  artistSlug?: string;
}) {
  const [q, setQ] = useState('');
  const enabled = q.trim().length > 0 || !!artistSlug;
  const wantsReleases = kind === 'song' || kind === 'release';
  const songs = useSongs({ q, artist: artistSlug, limit: 6, sort: 'popular' }, wantsReleases && enabled);
  const artists = useArtists({ q, limit: 8 }, kind === 'artist' && enabled);
  // No public album index, so the editor reads the admin list.
  const albums = useQuery({
    queryKey: ['admin', 'albums', q],
    queryFn: () => api<{ items: AlbumCard[] }>('/admin/albums', { query: { q } }),
    enabled: kind === 'release' && enabled,
  });
  const [open, setOpen] = useState(false);

  const songHits: PickRef[] = (songs.data?.items ?? []).map((s) => ({
    type: 'song',
    id: s.id,
    slug: s.slug,
    title: s.title,
    coverUrl: s.coverUrl ?? s.album?.coverUrl ?? null,
    artistName: s.artist.name,
  }));
  const albumHits: PickRef[] = (albums.data?.items ?? [])
    .slice(0, 5)
    .map((a) => ({ type: 'album', id: a.id, slug: a.slug, title: a.title, coverUrl: a.coverUrl, artistName: a.artist.name }));

  // Albums lead: there are far fewer of them, so they would otherwise never surface.
  const results: (PickRef | ArtistRef)[] =
    kind === 'artist'
      ? (artists.data?.items ?? []).map((a) => ({ id: a.id, slug: a.slug, name: a.name, imageUrl: a.imageUrl }))
      : kind === 'release'
        ? [...albumHits, ...songHits]
        : songHits;

  return (
    <div className="relative">
      <input
        className="input"
        placeholder={placeholder ?? (kind === 'artist' ? 'Search artists…' : kind === 'release' ? 'Search songs and albums to add…' : 'Search songs to add…')}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
      />
      {open && enabled && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border-2 border-ink bg-surface shadow-hard">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(r);
                  setQ('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-neon"
              >
                <div className="size-8 shrink-0 border border-ink">
                  <Artwork src={'title' in r ? r.coverUrl : r.imageUrl} name={'title' in r ? r.title : r.name} seed={r.slug} live />
                </div>
                {'type' in r && (
                  <span className={`mono shrink-0 border border-ink px-1.5 py-0.5 !text-[10px] ${r.type === 'album' ? 'bg-neon' : 'bg-surface-2'}`}>
                    {r.type === 'album' ? 'Album' : 'Song'}
                  </span>
                )}
                <span className="truncate text-sm font-semibold">{'title' in r ? r.title : r.name}</span>
                {'artistName' in r && <span className="mono ml-auto shrink-0 text-muted">{r.artistName}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Song" / "Album" tag, so a mixed list says what each row is at a glance. */
function TypeTag({ type }: { type: 'song' | 'album' }) {
  return (
    <span className={`mono shrink-0 border border-ink px-1.5 py-0.5 !text-[10px] ${type === 'album' ? 'bg-neon' : 'bg-surface-2'}`}>
      {type === 'album' ? 'Album' : 'Song'}
    </span>
  );
}

function RefLabel({ id, kind, refs }: { id: string; kind: 'song' | 'artist' | 'release'; refs: Refs }) {
  if (kind === 'artist') {
    const a = refs.artists[id];
    return a ? <b className="truncate uppercase">{a.name}</b> : <span className="text-red">Missing artist</span>;
  }

  // Release ids carry their type; a plain song picker (ticker, chart) passes a bare id.
  const [prefix, rest] = id.includes(':') ? id.split(':') : ['song', id];
  const type = prefix === 'album' ? ('album' as const) : ('song' as const);
  const row = type === 'album' ? refs.albums?.[rest] : refs.songs[rest];
  return row ? (
    <span className="flex min-w-0 items-center gap-2">
      {kind === 'release' && <TypeTag type={type} />}
      <span className="truncate">
        <b className="uppercase">{row.title}</b> <span className="text-muted">- {row.artistName}</span>
      </span>
    </span>
  ) : (
    <span className="text-red">Missing {type}</span>
  );
}

/** Ordered list of ids with move / remove controls. */
function IdList({ ids, kind, refs, onChange, numbered }: { ids: string[]; kind: 'song' | 'artist' | 'release'; refs: Refs; onChange: (ids: string[]) => void; numbered?: boolean }) {
  if (!ids.length) return <p className="text-sm text-muted italic">Nothing added yet.</p>;
  return (
    <ol className="border-2 border-ink">
      {ids.map((id, i) => (
        <li key={id} className="flex items-center gap-2 border-b border-dashed border-ink/25 px-3 py-1.5 last:border-b-0">
          {numbered && <span className="display w-7 text-xl">{String(i + 1).padStart(2, '0')}</span>}
          <span className="min-w-0 flex-1 text-sm">
            <RefLabel id={id} kind={kind} refs={refs} />
          </span>
          <IconBtn label="Move up" onClick={() => onChange(move(ids, i, -1))} disabled={i === 0}>
            <ArrowUp size={14} />
          </IconBtn>
          <IconBtn label="Move down" onClick={() => onChange(move(ids, i, 1))} disabled={i === ids.length - 1}>
            <ArrowDown size={14} />
          </IconBtn>
          <IconBtn label="Remove" onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={14} />
          </IconBtn>
        </li>
      ))}
    </ol>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="p-1.5 hover:bg-neon disabled:opacity-25">
      {children}
    </button>
  );
}

// ---------- Panels ----------

const MAX_SLIDES = 10;
const EMPTY_ARTIST_SLIDE: ArtistSlide = { type: 'artist', artistId: null, songId: null, kicker: null, blurb: null, startsAt: null, endsAt: null };
const EMPTY_NEWS_SLIDE: NewsSlide = {
  type: 'news',
  kicker: null,
  headline: '',
  body: null,
  slug: null,
  article: null,
  shareable: false,
  imageUrl: null,
  linkUrl: null,
  linkLabel: null,
  artistIds: [],
  startsAt: null,
  endsAt: null,
};

/** Slides the server would reject yet (no artist / no headline) are left out of a save. */
const isComplete = (s: CoverSlide) => (s.type === 'artist' ? !!s.artistId : !!s.headline.trim());

function ScheduleFields({ slide, onChange }: { slide: CoverSlide; onChange: (patch: { startsAt?: string | null; endsAt?: string | null }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Starts">
        <input type="datetime-local" className="input" value={toLocalInput(slide.startsAt)} onChange={(e) => onChange({ startsAt: fromLocalInput(e.target.value) })} />
      </Field>
      <Field label="Ends">
        <input type="datetime-local" className="input" value={toLocalInput(slide.endsAt)} onChange={(e) => onChange({ endsAt: fromLocalInput(e.target.value) })} />
      </Field>
    </div>
  );
}

function ArtistSlideFields({
  slide,
  refs,
  addRef,
  onChange,
}: {
  slide: ArtistSlide;
  refs: Refs;
  addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void;
  onChange: (s: ArtistSlide) => void;
}) {
  const artist = slide.artistId ? refs.artists[slide.artistId] : null;
  const set = (patch: Partial<ArtistSlide>) => onChange({ ...slide, ...patch });
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Artist *">
          {artist ? (
            <div className="flex items-center gap-3 border-2 border-ink bg-paper p-2">
              <div className="size-10 border border-ink">
                <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} live />
              </div>
              <b className="flex-1 uppercase">{artist.name}</b>
              <IconBtn label="Change artist" onClick={() => set({ artistId: null, songId: null })}>
                <X size={14} />
              </IconBtn>
            </div>
          ) : (
            <Picker
              kind="artist"
              onPick={(r) => {
                addRef(r);
                set({ artistId: r.id, songId: null });
              }}
            />
          )}
        </Field>
        <Field label="Song to promote" hint="Leave empty to use the artist's latest release">
          {slide.songId ? (
            <div className="flex items-center gap-2 border-2 border-ink bg-paper px-3 py-2 text-sm">
              <span className="flex-1 truncate">
                <RefLabel id={slide.songId} kind="song" refs={refs} />
              </span>
              <IconBtn label="Clear song" onClick={() => set({ songId: null })}>
                <X size={14} />
              </IconBtn>
            </div>
          ) : (
            <Picker
              kind="song"
              artistSlug={artist?.slug}
              placeholder={artist ? `Songs by ${artist.name}…` : 'Pick an artist first'}
              onPick={(r) => {
                addRef(r);
                set({ songId: r.id });
              }}
            />
          )}
        </Field>
        <Field label="Sticker text" hint={'e.g. "Legacy S1 winner". Default: "Editor\'s pick"'}>
          <input className="input" maxLength={40} value={slide.kicker ?? ''} onChange={(e) => set({ kicker: e.target.value })} />
        </Field>
        <ScheduleFields slide={slide} onChange={set} />
      </div>
      <div className="mt-4">
        <Field label="Blurb" hint="Replaces the artist bio on the slide. Leave empty to use the bio.">
          <textarea className="input min-h-20" maxLength={500} value={slide.blurb ?? ''} onChange={(e) => set({ blurb: e.target.value })} />
        </Field>
      </div>
    </>
  );
}

function NewsSlideFields({
  slide,
  refs,
  addRef,
  onChange,
}: {
  slide: NewsSlide;
  refs: Refs;
  addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void;
  onChange: (s: NewsSlide) => void;
}) {
  const set = (patch: Partial<NewsSlide>) => onChange({ ...slide, ...patch });
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label="Headline *">
            <input
              className="input !text-base font-bold"
              maxLength={120}
              placeholder="e.g. Seedhe Maut announce India tour"
              value={slide.headline}
              onChange={(e) => set({ headline: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Sticker text" hint={'e.g. "Breaking", "Tour", "Beef". Default: "News"'}>
          <input className="input" maxLength={40} value={slide.kicker ?? ''} onChange={(e) => set({ kicker: e.target.value })} />
        </Field>
        <ScheduleFields slide={slide} onChange={set} />
        <Field label="Image link" hint="An https:// image address (right-click an image → Copy image address). Optional.">
          <input className="input" placeholder="https://…" value={slide.imageUrl ?? ''} onChange={(e) => set({ imageUrl: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_10rem] gap-3">
          <Field label="Read more link" hint="A page here (/shows/legacy) or a full https:// article link">
            <input className="input" placeholder="/shows/… or https://…" value={slide.linkUrl ?? ''} onChange={(e) => set({ linkUrl: e.target.value })} />
          </Field>
          <Field label="Button text">
            <input className="input" maxLength={40} placeholder="Read more" value={slide.linkLabel ?? ''} onChange={(e) => set({ linkLabel: e.target.value })} />
          </Field>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        <label className="mono flex items-center gap-2 text-sm" title="Shows the Instagram share button to visitors too, not just staff.">
          <input type="checkbox" checked={slide.shareable} onChange={(e) => set({ shareable: e.target.checked })} /> Anyone can share this story
        </label>
        <Field label="Teaser" hint="A few lines for the carousel. Keep it short, it's a front page.">
          <textarea className="input min-h-24" maxLength={600} value={slide.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
        </Field>
        <div className="border-2 border-dashed border-ink/30 p-3">
          <Field
            label="Give it a page"
            hint={
              slide.slug
                ? `Readable at /story/${slide.slug}, with a "Read the full story" button on the slide.`
                : 'Leave empty and the slide stays a teaser with no page of its own.'
            }
          >
            <input
              className="input"
              maxLength={90}
              placeholder="seedhe-maut-india-tour"
              value={slide.slug ?? ''}
              onChange={(e) => set({ slug: e.target.value || null })}
            />
          </Field>
          {slide.slug && (
            <div className="mt-4">
              <Field label="Full story" hint="The long version, shown only on its page. Blank lines start a new paragraph.">
                <textarea className="input min-h-40" maxLength={8000} value={slide.article ?? ''} onChange={(e) => set({ article: e.target.value })} />
              </Field>
            </div>
          )}
        </div>
        <Field label="Artists in this story" hint="Shown as chips linking to their pages (up to 6).">
          <div className="flex flex-wrap items-center gap-2">
            {slide.artistIds.map((id) => (
              <span key={id} className="chip !normal-case">
                <RefLabel id={id} kind="artist" refs={refs} />
                <button type="button" aria-label="Remove artist" onClick={() => set({ artistIds: slide.artistIds.filter((x) => x !== id) })}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          {slide.artistIds.length < 6 && (
            <div className="mt-2 max-w-sm">
              <Picker
                kind="artist"
                placeholder="Tag an artist…"
                onPick={(r) => {
                  addRef(r);
                  if (!slide.artistIds.includes(r.id)) set({ artistIds: [...slide.artistIds, r.id] });
                }}
              />
            </div>
          )}
        </Field>
      </div>
    </>
  );
}

/** One line describing a slide, so a closed row still says what it is. */
function slideSummary(slide: CoverSlide, refs: Refs) {
  if (slide.type === 'news') return slide.headline.trim() || 'Untitled story';
  const artist = slide.artistId ? refs.artists[slide.artistId] : null;
  return artist?.name ?? 'No artist picked';
}

/**
 * A slide row. Closed it is one line, so ten slides fit on screen and can be dragged
 * into order without scrolling; open it is the full editor, one at a time.
 */
function CoverSlideEditor({
  slide,
  index,
  total,
  refs,
  addRef,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
  drag,
}: {
  slide: CoverSlide;
  index: number;
  total: number;
  refs: Refs;
  addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void;
  open: boolean;
  onToggle: () => void;
  onChange: (s: CoverSlide) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  drag: {
    isDragging: boolean;
    isOver: boolean;
    onStart: () => void;
    onEnd: () => void;
    onOver: () => void;
    onDrop: () => void;
  };
}) {
  // Switching type keeps the sticker and schedule.
  const switchType = (type: CoverSlide['type']) => {
    if (type === slide.type) return;
    const keep = { kicker: slide.kicker, startsAt: slide.startsAt, endsAt: slide.endsAt };
    onChange(type === 'news' ? { ...EMPTY_NEWS_SLIDE, ...keep } : { ...EMPTY_ARTIST_SLIDE, ...keep });
  };

  const artist = slide.type === 'artist' && slide.artistId ? refs.artists[slide.artistId] : null;
  const scheduled = !!(slide.startsAt || slide.endsAt);

  return (
    <li
      onDragOver={(e) => {
        e.preventDefault();
        drag.onOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        drag.onDrop();
      }}
      className={`border-2 border-ink bg-surface transition ${drag.isDragging ? 'opacity-40' : ''} ${
        drag.isOver && !drag.isDragging ? 'border-dashed !border-saffron' : ''
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <span
          draggable
          onDragStart={drag.onStart}
          onDragEnd={drag.onEnd}
          title="Drag to reorder"
          aria-label={`Drag slide ${index + 1} to reorder`}
          className="cursor-grab px-1 text-dim hover:text-ink active:cursor-grabbing"
        >
          <GripVertical size={16} />
        </span>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={open}>
          {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          <span className="mono shrink-0 text-muted">{String(index + 1).padStart(2, '0')}</span>
          {artist && (
            <span className="size-7 shrink-0 border border-ink">
              <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} live />
            </span>
          )}
          <span className={`mono shrink-0 border-2 border-ink px-1.5 py-0.5 ${slide.type === 'news' ? 'bg-neon' : 'bg-surface-2'}`}>
            {slide.type === 'news' ? 'News' : 'Artist'}
          </span>
          <span className={`truncate font-bold uppercase ${isComplete(slide) ? '' : 'text-dim'}`}>{slideSummary(slide, refs)}</span>
          {scheduled && (
            <span className="mono flex shrink-0 items-center gap-1 text-dim" title="Only shows inside its date window">
              <Clock size={11} /> scheduled
            </span>
          )}
          {!isComplete(slide) && <span className="mono shrink-0 bg-red px-1.5 py-0.5 text-paper">unfinished</span>}
        </button>
        <IconBtn label="Move up" onClick={() => onMove(-1)} disabled={index === 0}>
          <ArrowUp size={14} />
        </IconBtn>
        <IconBtn label="Move down" onClick={() => onMove(1)} disabled={index === total - 1}>
          <ArrowDown size={14} />
        </IconBtn>
        <IconBtn label="Remove slide" onClick={onRemove}>
          <Trash2 size={14} />
        </IconBtn>
      </div>

      {open && (
        <div className="border-t-2 border-dashed border-ink/30 p-4">
          <div className="mb-3">
            <Segmented
              value={slide.type}
              onChange={switchType}
              options={[
                { value: 'artist', label: 'Artist feature' },
                { value: 'news', label: 'News' },
              ]}
            />
          </div>
          {slide.type === 'artist' ? (
            <ArtistSlideFields slide={slide} refs={refs} addRef={addRef} onChange={onChange} />
          ) : (
            <NewsSlideFields slide={slide} refs={refs} addRef={addRef} onChange={onChange} />
          )}
        </div>
      )}
    </li>
  );
}

function CoverStoryPanel({ initial, refs, addRef }: { initial: CoverStory; refs: Refs; addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<CoverStory>('coverStory');
  const setSlide = (i: number, s: CoverSlide) => setV({ ...v, slides: v.slides.map((x, j) => (j === i ? s : x)) });
  /** Only one slide is expanded at a time; the rest stay one line each. */
  const [open, setOpen] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  /** Moves a slide and keeps whichever one is expanded expanded. */
  const reorder = (from: number, to: number) => {
    if (from === to || to < 0 || to >= v.slides.length) return;
    const slides = [...v.slides];
    slides.splice(to, 0, ...slides.splice(from, 1));
    setV({ ...v, slides });
    setOpen((i) => {
      if (i === null) return null;
      if (i === from) return to;
      if (from < i && i <= to) return i - 1;
      if (to <= i && i < from) return i + 1;
      return i;
    });
  };

  const removeSlide = (i: number) => {
    setV({ ...v, slides: v.slides.filter((_, j) => j !== i) });
    setOpen((cur) => (cur === null ? null : cur === i ? null : cur > i ? cur - 1 : cur));
  };

  return (
    <Panel
      id="cover-story"
      title="Cover story"
      description="The carousel at the top of the front page."
      // Slides still waiting for an artist are dropped rather than failing the save.
      onSave={() => save({ ...v, slides: v.slides.filter(isComplete) })}
      saving={saving}
      status={status}
    >
      <Segmented
        value={v.mode}
        onChange={(mode) => setV({ ...v, mode, slides: mode === 'manual' && !v.slides.length ? [EMPTY_ARTIST_SLIDE] : v.slides })}
        options={[
          { value: 'auto', label: 'Automatic' },
          { value: 'manual', label: "Editor's picks" },
          { value: 'hidden', label: 'Hidden' },
        ]}
      />
      {v.mode === 'auto' && (
        <p className="text-sm text-muted">
          Three slides with the latest drops from featured artists, or for signed-in users, from artists they follow.
        </p>
      )}
      {v.mode === 'manual' && (
        <>
          <ol className="space-y-2" onDragEnd={() => setDragOver(null)}>
            {v.slides.map((s, i) => (
              <CoverSlideEditor
                key={i}
                slide={s}
                index={i}
                total={v.slides.length}
                refs={refs}
                addRef={addRef}
                open={open === i}
                onToggle={() => setOpen(open === i ? null : i)}
                onChange={(next) => setSlide(i, next)}
                onMove={(dir) => reorder(i, i + dir)}
                onRemove={() => removeSlide(i)}
                drag={{
                  isDragging: dragFrom === i,
                  isOver: dragOver === i,
                  onStart: () => setDragFrom(i),
                  onEnd: () => {
                    setDragFrom(null);
                    setDragOver(null);
                  },
                  onOver: () => setDragOver(i),
                  onDrop: () => {
                    if (dragFrom !== null) reorder(dragFrom, i);
                    setDragFrom(null);
                    setDragOver(null);
                  },
                }}
              />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-ghost"
              disabled={v.slides.length >= MAX_SLIDES}
              onClick={() => {
                setV({ ...v, slides: [...v.slides, EMPTY_ARTIST_SLIDE] });
                setOpen(v.slides.length); // open the one just added
              }}
            >
              <Plus size={14} /> Add slide
            </button>
            {open !== null && (
              <button type="button" className="mono text-muted hover:underline" onClick={() => setOpen(null)}>
                Collapse
              </button>
            )}
            <p className="text-xs text-dim">Drag the handle to reorder. Click a slide to edit it.</p>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={v.autoFill} onChange={(e) => setV({ ...v, autoFill: e.target.checked })} />
            <span>
              <b>Fill up with automatic slides.</b> When fewer than 3 of your slides are live, the latest drops fill the rest.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={v.forceForEveryone} onChange={(e) => setV({ ...v, forceForEveryone: e.target.checked })} />
            <span>
              <b>Your picks lead for everyone.</b> When off, signed-in users who follow artists see new drops from those artists first.
            </span>
          </label>
          <p className="text-xs text-dim">Slides outside their start/end window are skipped.</p>
        </>
      )}
      {v.mode !== 'hidden' && (
        <div className="max-w-xs">
          <Field label="Seconds per slide" hint="Autoplay pauses on hover and for visitors who prefer reduced motion.">
            <input
              type="number"
              className="input"
              min={3}
              max={30}
              value={v.intervalSeconds}
              onChange={(e) => setV({ ...v, intervalSeconds: Math.min(30, Math.max(3, Number(e.target.value) || 7)) })}
            />
          </Field>
        </div>
      )}
    </Panel>
  );
}

const TONE_OPTIONS: { value: Tone; label: string; cls: string }[] = [
  { value: 'saffron', label: 'Saffron', cls: 'bg-saffron text-ink' },
  { value: 'ink', label: 'Ink', cls: 'bg-ink text-paper' },
  { value: 'red', label: 'Red', cls: 'bg-red text-paper' },
  { value: 'neon', label: 'Highlighter', cls: 'bg-neon text-ink' },
];

/** Mirrors currentIssue() in backend/src/modules/site/config.ts, for the live preview. */
function previewIssue(v: Issue, saved: Issue) {
  if (v.mode === 'auto') {
    const d = new Date();
    const start = Date.UTC(d.getUTCFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - start) / 86_400_000 + new Date(start).getUTCDay() + 1) / 7);
  }
  // An unchanged number keeps counting from when it was saved; a new one starts now.
  const since = v.number === saved.number && saved.mode === 'manual' ? saved.since : null;
  if (!v.countUp || !since) return v.number;
  return v.number + Math.max(0, Math.floor((Date.now() - Date.parse(since)) / (7 * 86_400_000)));
}

function IssuePanel({ initial }: { initial: Issue }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<Issue>('issue');

  return (
    <Panel
      id="issue"
      title="Issue number"
      description='The "Issue #" printed on the front page masthead, cover stories and footer.'
      onSave={() => save(v)}
      saving={saving}
      status={status}
    >
      <div className="flex flex-wrap items-end gap-6">
        <Segmented
          value={v.mode}
          onChange={(mode) => 
            // Start a hand-set number from the one readers see now.
            setV({ ...v, mode, number: mode === 'manual' && initial.mode === 'auto' ? previewIssue(v, initial) : v.number })
          }
          options={[
            { value: 'auto', label: 'Week of the year' },
            { value: 'manual', label: 'Set it myself' },
          ]}
        />
        {v.mode === 'manual' && (
          <Field label="Issue number">
            <input
              type="number"
              className="input !w-32"
              min={1}
              max={99999}
              value={v.number}
              onChange={(e) => setV({ ...v, number: Math.min(99_999, Math.max(1, Number(e.target.value) || 1)) })}
            />
          </Field>
        )}
        <p className="display text-4xl">Issue #{previewIssue(v, initial)}</p>
      </div>
      {v.mode === 'manual' && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={v.countUp} onChange={(e) => setV({ ...v, countUp: e.target.checked })} />
          <span>
            <b>Count up every week.</b> Goes up by one each week from when you save, so you don't have to update it. When off, the number stays
            until you change it.
          </span>
        </label>
      )}
    </Panel>
  );
}

function AnnouncementPanel({ initial }: { initial: Announcement }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<Announcement>('announcement');
  const tone = TONE_OPTIONS.find((t) => t.value === v.tone)!;

  return (
    <Panel id="announcement" title="Announcement banner" description="A strip above the header on every page, for tours, releases or notices." onSave={() => save(v)} saving={saving} status={status}>
      <label className="flex items-center gap-2 font-semibold">
        <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Banner is live
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Text">
          <input className="input" maxLength={200} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} />
        </Field>
        <Field label="Expires" hint="Optional. The banner hides itself after this time.">
          <input type="datetime-local" className="input" value={toLocalInput(v.expiresAt)} onChange={(e) => setV({ ...v, expiresAt: fromLocalInput(e.target.value) })} />
        </Field>
        <Field label="Link" hint="/artists/seedhe-maut or https://…">
          <input className="input" value={v.linkUrl ?? ''} onChange={(e) => setV({ ...v, linkUrl: e.target.value })} />
        </Field>
        <Field label="Link label" hint='Default: "Read more"'>
          <input className="input" maxLength={40} value={v.linkLabel ?? ''} onChange={(e) => setV({ ...v, linkLabel: e.target.value })} />
        </Field>
      </div>
      <Field label="Colour">
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((t) => (
            <button
              type="button"
              key={t.value}
              onClick={() => setV({ ...v, tone: t.value })}
              className={`mono border-2 border-ink px-3 py-1.5 ${t.cls} ${v.tone === t.value ? 'shadow-hard-sm outline-2 outline-offset-2 outline-ink' : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Field>
      <div>
        <span className="label">Preview</span>
        <div className={`mono border-2 border-ink px-4 py-2 text-center ${tone.cls} ${v.enabled ? '' : 'opacity-50'}`}>
          {v.text || 'Your announcement'} {v.linkUrl && <u>{v.linkLabel || 'Read more'} →</u>}
        </div>
      </div>
    </Panel>
  );
}

/** Toggle chips for picking genres / cities by slug. */
function SlugChips({ options, value, onChange }: { options: { slug: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
      {options.map((o) => {
        const on = value.includes(o.slug);
        return (
          <button
            key={o.slug}
            type="button"
            aria-pressed={on}
            className={`chip ${on ? 'chip-active' : ''}`}
            onClick={() => onChange(on ? value.filter((s) => s !== o.slug) : [...value, o.slug])}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

function TickerPanel({ initial, refs, addRef }: { initial: Ticker; refs: Refs; addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void }) {
  const [v, setV] = useState(initial);
  const [text, setText] = useState({ text: '', linkUrl: '' });
  const { save, saving, status } = useSaveSetting<Ticker>('ticker');
  const genres = useGenres();
  const regions = useRegions();
  const shows = useShows();
  const showName = (id: string) => shows.data?.items.find((s) => s.id === id)?.name ?? 'Unknown show';

  const setItems = (items: TickerItem[]) => setV({ ...v, items });
  const setAuto = (patch: Partial<Ticker['auto']>) => setV({ ...v, auto: { ...v.auto, ...patch } });
  const addItem = (item: TickerItem, same: (i: TickerItem) => boolean) => {
    if (!v.items.some(same)) setItems([...v.items, item]);
  };

  return (
    <Panel id="ticker" title="Ticker (New drops)" description="The scrolling strip under the header." onSave={() => save(v)} saving={saving} status={status}>
      <div className="flex flex-wrap items-end gap-4">
        <Segmented
          value={v.mode}
          onChange={(mode) => setV({ ...v, mode })}
          options={[
            { value: 'auto', label: 'Picks + latest releases' },
            { value: 'manual', label: 'Picks only' },
            { value: 'hidden', label: 'Hidden' },
          ]}
        />
        <Field label="Label">
          <input className="input !w-44" maxLength={24} value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} />
        </Field>
      </div>

      {v.mode !== 'hidden' && (
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Colour">
            <div className="flex gap-1.5">
              {TONE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={v.tone === t.value}
                  onClick={() => setV({ ...v, tone: t.value })}
                  className={`mono border-2 px-2.5 py-1.5 ${t.cls} ${v.tone === t.value ? 'border-ink shadow-hard-sm' : 'border-transparent opacity-70'}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Speed">
            <Segmented
              value={v.speed}
              onChange={(speed) => setV({ ...v, speed })}
              options={[
                { value: 'slow', label: 'Slow' },
                { value: 'normal', label: 'Normal' },
                { value: 'fast', label: 'Fast' },
              ]}
            />
          </Field>
        </div>
      )}

      {v.mode !== 'hidden' && (
        <>
          <div>
            <p className="label">Your picks {v.mode === 'auto' && <span className="normal-case">(shown first, before the latest releases)</span>}</p>
            {v.items.length ? (
              <ol className="border-2 border-ink">
                {v.items.map((item, i) => (
                  <li key={i} className="flex items-center gap-2 border-b border-dashed border-ink/25 px-3 py-1.5 last:border-b-0">
                    <span className="mono w-14 text-muted">{item.type}</span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {item.type === 'song' ? (
                        <RefLabel id={item.songId} kind="song" refs={refs} />
                      ) : item.type === 'artist' ? (
                        <RefLabel id={item.artistId} kind="artist" refs={refs} />
                      ) : item.type === 'show' ? (
                        <b className="uppercase">{showName(item.showId)}</b>
                      ) : (
                        <>
                          <b>{item.text}</b> {item.linkUrl && <span className="text-muted">→ {item.linkUrl}</span>}
                        </>
                      )}
                    </span>
                    <IconBtn label="Move up" onClick={() => setItems(move(v.items, i, -1))} disabled={i === 0}>
                      <ArrowUp size={14} />
                    </IconBtn>
                    <IconBtn label="Move down" onClick={() => setItems(move(v.items, i, 1))} disabled={i === v.items.length - 1}>
                      <ArrowDown size={14} />
                    </IconBtn>
                    <IconBtn label="Remove" onClick={() => setItems(v.items.filter((_, j) => j !== i))}>
                      <X size={14} />
                    </IconBtn>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted italic">
                {v.mode === 'manual' ? 'No picks yet. The ticker stays hidden until you add some.' : 'No picks. Only the latest releases scroll by.'}
              </p>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Add a song">
              <Picker kind="song" onPick={(r) => {
                  addRef(r);
                  addItem({ type: 'song', songId: r.id }, (i) => i.type === 'song' && i.songId === r.id);
                }}
              />
            </Field>
            <Field label="Add an artist">
              <Picker kind="artist" onPick={(r) => {
                  addRef(r);
                  addItem({ type: 'artist', artistId: r.id }, (i) => i.type === 'artist' && i.artistId === r.id);
                }}
              />
            </Field>
            <Field label="Add a show">
              <select
                className="input"
                value=""
                onChange={(e) => e.target.value && addItem({ type: 'show', showId: e.target.value }, (i) => i.type === 'show' && i.showId === e.target.value)}
              >
                <option value="">Pick a show…</option>
                {shows.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Add a text item" hint="Link to a page here (/shows/legacy) or any https:// URL">
              <div className="flex gap-2">
                <input className="input" placeholder="Text" maxLength={120} value={text.text} onChange={(e) => setText({ ...text, text: e.target.value })} />
                <input className="input" placeholder="Link (optional)" value={text.linkUrl} onChange={(e) => setText({ ...text, linkUrl: e.target.value })} />
                <button
                  type="button"
                  className="btn-ghost !px-3"
                  disabled={!text.text.trim()}
                  onClick={() => {
                    setItems([...v.items, { type: 'text', text: text.text.trim(), linkUrl: text.linkUrl.trim() || null }]);
                    setText({ text: '', linkUrl: '' });
                  }}
                  aria-label="Add text item"
                >
                  <Plus size={14} />
                </button>
              </div>
            </Field>
          </div>
        </>
      )}

      {v.mode === 'auto' && (
        <div className="space-y-4 border-t-2 border-dashed border-ink/30 pt-5">
          <p className="label">Latest releases</p>
          <div className="flex flex-wrap gap-4">
            <Field label="How many">
              <input
                type="number"
                className="input !w-28"
                min={3}
                max={30}
                value={v.auto.count}
                onChange={(e) => setAuto({ count: Math.min(30, Math.max(3, Number(e.target.value) || 12)) })}
              />
            </Field>
            <Field label="Released in the last" hint="Days. Empty = any time">
              <input
                type="number"
                className="input !w-36"
                min={1}
                placeholder="Any time"
                value={v.auto.withinDays ?? ''}
                onChange={(e) => setAuto({ withinDays: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
              />
            </Field>
          </div>
          <Field label="Only these sounds" hint="None selected = every genre">
            <SlugChips options={genres.data?.items ?? []} value={v.auto.genreSlugs} onChange={(genreSlugs) => setAuto({ genreSlugs })} />
          </Field>
          <Field label="Only these cities" hint="None selected = everywhere">
            <SlugChips options={regions.data?.items ?? []} value={v.auto.regionSlugs} onChange={(regionSlugs) => setAuto({ regionSlugs })} />
          </Field>
          <p className="text-xs text-dim">If the filters match nothing, only your picks show (or the ticker hides when there are none).</p>
        </div>
      )}
    </Panel>
  );
}

function SectionsPanel({
  initial,
  builtins,
  refs,
  addRef,
}: {
  initial: SectionItem[];
  builtins: SiteConfigResponse['builtins'];
  refs: Refs;
  addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void;
}) {
  const [items, setItems] = useState(initial);
  const dialog = useDialog();
  const [draft, setDraft] = useState<{ title: string; kind: 'releases' | 'artists' }>({ title: '', kind: 'releases' });
  const { save, saving, status } = useSaveSetting<{ items: SectionItem[] }>('sections');
  const meta = Object.fromEntries(builtins.map((b) => [b.key, b]));
  const update = (i: number, patch: Partial<SectionItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <Panel
      id="layout"
      title="Front page layout"
      description="Order, show/hide and rename blocks, or add your own curated ones. The cover story always comes first."
      onSave={() => save({ items })}
      saving={saving}
      status={status}
    >
      <ol className="space-y-2">
        {items.map((item, i) => {
          const b = meta[item.key];
          const custom = item.custom;
          return (
            <li key={item.key} className={`border-2 border-ink ${item.visible ? 'bg-surface' : 'bg-surface-2 opacity-70'}`}>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span className="display w-8 text-2xl">{String(i + 1).padStart(2, '0')}</span>
                <div className="min-w-48 flex-1">
                  <p className="mono text-muted">
                    {custom ? (custom.kind === 'releases' ? 'Curated songs & albums' : 'Curated artists') : (b?.label ?? item.key)}
                    {b?.audience === 'signed-in' && <span className="ml-2 bg-neon px-1 text-ink">signed-in only</span>}
                  </p>
                  {item.key !== 'taste' && (
                    <input
                      className="input mt-1 !py-1.5"
                      placeholder={custom ? 'Section title *' : 'Default title (type to override)'}
                      value={item.title ?? ''}
                      onChange={(e) => update(i, { title: e.target.value })}
                    />
                  )}
                </div>
                <IconBtn label={item.visible ? 'Hide' : 'Show'} onClick={() => update(i, { visible: !item.visible })}>
                  {item.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                </IconBtn>
                <IconBtn label="Move up" onClick={() => setItems(move(items, i, -1))} disabled={i === 0}>
                  <ArrowUp size={16} />
                </IconBtn>
                <IconBtn label="Move down" onClick={() => setItems(move(items, i, 1))} disabled={i === items.length - 1}>
                  <ArrowDown size={16} />
                </IconBtn>
                {custom && (
                  <IconBtn
                    label="Delete section"
                    onClick={async () => {
                      if (await dialog.confirm(`Remove the "${item.title}" section? It disappears from the front page when you save.`, { confirmLabel: 'Remove' }))
                        setItems((cur) => cur.filter((x) => x.key !== item.key));
                    }}
                  >
                    <Trash2 size={16} />
                  </IconBtn>
                )}
              </div>
              {custom && (
                <div className="space-y-2 border-t-2 border-dashed border-ink/30 p-3">
                  <input
                    className="input !py-1.5"
                    placeholder="Subtitle (optional)"
                    value={item.subtitle ?? ''}
                    onChange={(e) => update(i, { subtitle: e.target.value })}
                  />
                  <IdList
                    ids={custom.ids}
                    kind={custom.kind === 'releases' ? 'release' : 'artist'}
                    refs={refs}
                    onChange={(ids) => update(i, { custom: { ...custom, ids } })}
                  />
                  <Picker
                    kind={custom.kind === 'releases' ? 'release' : 'artist'}
                    onPick={(r) => {
                      // Releases remember which they are; artists stay bare ids.
                      const ref = 'type' in r ? `${r.type}:${r.id}` : r.id;
                      addRef(r, 'type' in r && r.type === 'album' ? 'album' : undefined);
                      if (!custom.ids.includes(ref)) update(i, { custom: { ...custom, ids: [...custom.ids, ref] } });
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-end gap-2 border-2 border-dashed border-ink p-3">
        <Field label="New curated section">
          <input className="input !w-64" placeholder='e.g. "Drill season"' value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Segmented
          value={draft.kind}
          onChange={(kind) => setDraft({ ...draft, kind })}
          options={[
            { value: 'releases', label: 'Songs & albums' },
            { value: 'artists', label: 'Artists' },
          ]}
        />
        <button
          type="button"
          className="btn-ghost"
          disabled={!draft.title.trim()}
          onClick={() => {
            const key = `custom-${Date.now().toString(36)}`;
            setItems([{ key, visible: true, title: draft.title.trim(), subtitle: null, custom: { kind: draft.kind, ids: [] } }, ...items]);
            setDraft({ title: '', kind: draft.kind });
          }}
        >
          <Plus size={14} /> Add to top
        </button>
      </div>
    </Panel>
  );
}

function ChartPanel({ initial, refs, addRef }: { initial: Chart; refs: Refs; addRef: (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') => void }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<Chart>('chart');

  return (
    <Panel
      id="chart"
      title="The Chart"
      description="Pinned songs always sit at the top in your order; excluded songs never appear."
      onSave={() => save(v)}
      saving={saving}
      status={status}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title" hint='Default: "The Chart"'>
          <input className="input" maxLength={60} value={v.title ?? ''} onChange={(e) => setV({ ...v, title: e.target.value })} />
        </Field>
        <Field label="Number of songs">
          <input
            type="number"
            min={5}
            max={25}
            className="input"
            value={v.size}
            onChange={(e) => setV({ ...v, size: Math.min(25, Math.max(5, Number(e.target.value) || 10)) })}
          />
        </Field>
        <Field label="Subtitle" hint="Default depends on the order below">
          <input className="input" maxLength={80} value={v.subtitle ?? ''} onChange={(e) => setV({ ...v, subtitle: e.target.value })} />
        </Field>
        <Field label="Max per artist" hint="0 = no limit. Stops one prolific artist filling the chart.">
          <input
            type="number"
            min={0}
            max={10}
            className="input"
            value={v.maxPerArtist}
            onChange={(e) => setV({ ...v, maxPerArtist: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })}
          />
        </Field>
        <Field label="Order" hint="Likes needs a busy site; newest or shuffle work better early on">
          <Segmented
            value={v.sort}
            onChange={(sort) => setV({ ...v, sort })}
            options={[
              { value: 'likes', label: 'Most liked' },
              { value: 'new', label: 'Newest' },
              { value: 'random', label: 'Shuffle' },
            ]}
          />
        </Field>
      </div>

      <Field
        label="Only these artists"
        hint={v.artistIds.length ? 'The chart uses their songs (including tracks they feature on). Leave empty for the whole catalog.' : 'Empty: every artist is eligible.'}
      >
        <IdList ids={v.artistIds} kind="artist" refs={refs} onChange={(artistIds) => setV({ ...v, artistIds })} />
        {v.artistIds.length < 30 && (
          <div className="mt-2 max-w-sm">
            <Picker
              kind="artist"
              placeholder="Add an artist…"
              onPick={(r) => {
                addRef(r);
                if (!v.artistIds.includes(r.id)) setV({ ...v, artistIds: [...v.artistIds, r.id] });
              }}
            />
          </div>
        )}
      </Field>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <span className="label">Pinned to the top (max 10)</span>
          <IdList ids={v.pinnedSongIds} kind="song" refs={refs} numbered onChange={(pinnedSongIds) => setV({ ...v, pinnedSongIds })} />
          {v.pinnedSongIds.length < 10 && (
            <Picker
              kind="song"
              placeholder="Pin a song…"
              onPick={(r) => {
                addRef(r);
                if (!v.pinnedSongIds.includes(r.id))
                  setV({ ...v, pinnedSongIds: [...v.pinnedSongIds, r.id], excludedSongIds: v.excludedSongIds.filter((x) => x !== r.id) });
              }}
            />
          )}
        </div>
        <div className="space-y-2">
          <span className="label">Excluded</span>
          <IdList ids={v.excludedSongIds} kind="song" refs={refs} onChange={(excludedSongIds) => setV({ ...v, excludedSongIds })} />
          <Picker
            kind="song"
            placeholder="Exclude a song…"
            onPick={(r) => {
              addRef(r);
              if (!v.excludedSongIds.includes(r.id))
                setV({ ...v, excludedSongIds: [...v.excludedSongIds, r.id], pinnedSongIds: v.pinnedSongIds.filter((x) => x !== r.id) });
            }}
          />
        </div>
      </div>
    </Panel>
  );
}

// ---------- Page ----------

export function FrontPageAdmin() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'site-config'],
    queryFn: () => api<SiteConfigResponse>('/admin/site-config'),
    refetchOnWindowFocus: false,
  });
  const [refs, setRefs] = useState<Refs>({ songs: {}, artists: {}, albums: {} });

  useEffect(() => {
    if (data) setRefs((r) => ({ songs: { ...r.songs, ...data.refs.songs }, artists: { ...r.artists, ...data.refs.artists }, albums: { ...r.albums, ...data.refs.albums } }));
  }, [data]);

  const addRef = (r: SongRef | ArtistRef | AlbumRef, kind?: 'album') =>
    setRefs((prev) => {
      if (kind === 'album') return { ...prev, albums: { ...prev.albums, [r.id]: r as AlbumRef } };
      return 'title' in r ? { ...prev, songs: { ...prev.songs, [r.id]: r } } : { ...prev, artists: { ...prev.artists, [r.id]: r } };
    });

  if (isLoading || !data) return <Spinner />;
  const { config } = data;

  return (
    <div>
      <p className="mb-8 max-w-2xl text-muted">
        Changes go live as soon as you save. Signed-in visitors see personal sections mixed into the layout below; anonymous visitors see only the "everyone" blocks.
      </p>
      <PanelNav />
      <CoverStoryPanel initial={config.coverStory} refs={refs} addRef={addRef} />
      <SectionsPanel initial={config.sections.items} builtins={data.builtins} refs={refs} addRef={addRef} />
      <ChartPanel initial={config.chart} refs={refs} addRef={addRef} />
      <TickerPanel initial={config.ticker} refs={refs} addRef={addRef} />
      <AnnouncementPanel initial={config.announcement} />
      <IssuePanel initial={config.issue} />
    </div>
  );
}
