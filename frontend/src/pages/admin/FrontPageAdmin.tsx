import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useArtists, useGenres, useRegions, useShows, useSongs } from '../../lib/queries';
import { Artwork } from '../../components/Artwork';
import { Spinner } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import type { Tone } from '../../lib/types';

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
  custom?: { kind: 'songs' | 'artists'; ids: string[] };
}
interface Chart {
  title: string | null;
  size: number;
  pinnedSongIds: string[];
  excludedSongIds: string[];
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
  refs: { songs: Record<string, SongRef>; artists: Record<string, ArtistRef> };
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

function Panel({
  title,
  description,
  children,
  onSave,
  saving,
  status,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
  status: { ok: boolean; msg: string } | null;
}) {
  return (
    <section className="mb-10 border-2 border-ink bg-surface shadow-hard">
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

/** Type-ahead search for a song or artist. */
function Picker({
  kind,
  onPick,
  placeholder,
  artistSlug,
}: {
  kind: 'song' | 'artist';
  onPick: (ref: SongRef | ArtistRef) => void;
  placeholder?: string;
  artistSlug?: string;
}) {
  const [q, setQ] = useState('');
  const enabled = q.trim().length > 0 || !!artistSlug;
  const songs = useSongs({ q, artist: artistSlug, limit: 8, sort: 'popular' }, kind === 'song' && enabled);
  const artists = useArtists({ q, limit: 8 }, kind === 'artist' && enabled);
  const [open, setOpen] = useState(false);

  const results: (SongRef | ArtistRef)[] =
    kind === 'song'
      ? (songs.data?.items ?? []).map((s) => ({ id: s.id, slug: s.slug, title: s.title, coverUrl: s.coverUrl ?? s.album?.coverUrl ?? null, artistName: s.artist.name }))
      : (artists.data?.items ?? []).map((a) => ({ id: a.id, slug: a.slug, name: a.name, imageUrl: a.imageUrl }));

  return (
    <div className="relative">
      <input
        className="input"
        placeholder={placeholder ?? (kind === 'song' ? 'Search songs to add…' : 'Search artists…')}
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

function RefLabel({ id, kind, refs }: { id: string; kind: 'song' | 'artist'; refs: Refs }) {
  if (kind === 'song') {
    const s = refs.songs[id];
    return s ? (
      <span className="truncate">
        <b className="uppercase">{s.title}</b> <span className="text-muted">- {s.artistName}</span>
      </span>
    ) : (
      <span className="text-red">Missing song</span>
    );
  }
  const a = refs.artists[id];
  return a ? <b className="truncate uppercase">{a.name}</b> : <span className="text-red">Missing artist</span>;
}

/** Ordered list of ids with move / remove controls. */
function IdList({ ids, kind, refs, onChange, numbered }: { ids: string[]; kind: 'song' | 'artist'; refs: Refs; onChange: (ids: string[]) => void; numbered?: boolean }) {
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
  addRef: (r: SongRef | ArtistRef) => void;
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
  addRef: (r: SongRef | ArtistRef) => void;
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
        <Field label="Story" hint="A few lines. Keep it short, it's a front page.">
          <textarea className="input min-h-24" maxLength={600} value={slide.body ?? ''} onChange={(e) => set({ body: e.target.value })} />
        </Field>
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

function CoverSlideEditor({
  slide,
  index,
  total,
  refs,
  addRef,
  onChange,
  onMove,
  onRemove,
}: {
  slide: CoverSlide;
  index: number;
  total: number;
  refs: Refs;
  addRef: (r: SongRef | ArtistRef) => void;
  onChange: (s: CoverSlide) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  // Switching type keeps the sticker and schedule.
  const switchType = (type: CoverSlide['type']) => {
    if (type === slide.type) return;
    const keep = { kicker: slide.kicker, startsAt: slide.startsAt, endsAt: slide.endsAt };
    onChange(type === 'news' ? { ...EMPTY_NEWS_SLIDE, ...keep } : { ...EMPTY_ARTIST_SLIDE, ...keep });
  };

  return (
    <li className="border-2 border-ink bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="mono">Slide {String(index + 1).padStart(2, '0')}</span>
        <Segmented
          value={slide.type}
          onChange={switchType}
          options={[
            { value: 'artist', label: 'Artist feature' },
            { value: 'news', label: 'News' },
          ]}
        />
        <span className="flex-1" />
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
      {slide.type === 'artist' ? (
        <ArtistSlideFields slide={slide} refs={refs} addRef={addRef} onChange={onChange} />
      ) : (
        <NewsSlideFields slide={slide} refs={refs} addRef={addRef} onChange={onChange} />
      )}
    </li>
  );
}

function CoverStoryPanel({ initial, refs, addRef }: { initial: CoverStory; refs: Refs; addRef: (r: SongRef | ArtistRef) => void }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<CoverStory>('coverStory');
  const setSlide = (i: number, s: CoverSlide) => setV({ ...v, slides: v.slides.map((x, j) => (j === i ? s : x)) });

  return (
    <Panel
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
          <ol className="space-y-4">
            {v.slides.map((s, i) => (
              <CoverSlideEditor
                key={i}
                slide={s}
                index={i}
                total={v.slides.length}
                refs={refs}
                addRef={addRef}
                onChange={(next) => setSlide(i, next)}
                onMove={(dir) => setV({ ...v, slides: move(v.slides, i, dir) })}
                onRemove={() => setV({ ...v, slides: v.slides.filter((_, j) => j !== i) })}
              />
            ))}
          </ol>
          <button
            type="button"
            className="btn-ghost"
            disabled={v.slides.length >= MAX_SLIDES}
            onClick={() => setV({ ...v, slides: [...v.slides, EMPTY_ARTIST_SLIDE] })}
          >
            <Plus size={14} /> Add slide
          </button>
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
    <Panel title="Announcement banner" description="A strip above the header on every page, for tours, releases or notices." onSave={() => save(v)} saving={saving} status={status}>
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

function TickerPanel({ initial, refs, addRef }: { initial: Ticker; refs: Refs; addRef: (r: SongRef | ArtistRef) => void }) {
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
    <Panel title="Ticker (New drops)" description="The scrolling strip under the header." onSave={() => save(v)} saving={saving} status={status}>
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
  addRef: (r: SongRef | ArtistRef) => void;
}) {
  const [items, setItems] = useState(initial);
  const dialog = useDialog();
  const [draft, setDraft] = useState<{ title: string; kind: 'songs' | 'artists' }>({ title: '', kind: 'songs' });
  const { save, saving, status } = useSaveSetting<{ items: SectionItem[] }>('sections');
  const meta = Object.fromEntries(builtins.map((b) => [b.key, b]));
  const update = (i: number, patch: Partial<SectionItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  return (
    <Panel
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
                    {custom ? `Curated ${custom.kind}` : b?.label ?? item.key}
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
                    kind={custom.kind === 'songs' ? 'song' : 'artist'}
                    refs={refs}
                    onChange={(ids) => update(i, { custom: { ...custom, ids } })}
                  />
                  <Picker
                    kind={custom.kind === 'songs' ? 'song' : 'artist'}
                    onPick={(r) => {
                      addRef(r);
                      if (!custom.ids.includes(r.id)) update(i, { custom: { ...custom, ids: [...custom.ids, r.id] } });
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
            { value: 'songs', label: 'Songs' },
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

function ChartPanel({ initial, refs, addRef }: { initial: Chart; refs: Refs; addRef: (r: SongRef | ArtistRef) => void }) {
  const [v, setV] = useState(initial);
  const { save, saving, status } = useSaveSetting<Chart>('chart');

  return (
    <Panel
      title="The Chart"
      description="Ranked by likes. Pinned songs always sit at the top in your order; excluded songs never appear."
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
      </div>
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
  const [refs, setRefs] = useState<Refs>({ songs: {}, artists: {} });

  useEffect(() => {
    if (data) setRefs((r) => ({ songs: { ...r.songs, ...data.refs.songs }, artists: { ...r.artists, ...data.refs.artists } }));
  }, [data]);

  const addRef = (r: SongRef | ArtistRef) =>
    setRefs((prev) =>
      'title' in r ? { ...prev, songs: { ...prev.songs, [r.id]: r } } : { ...prev, artists: { ...prev.artists, [r.id]: r } },
    );

  if (isLoading || !data) return <Spinner />;
  const { config } = data;

  return (
    <div>
      <p className="mb-8 max-w-2xl text-muted">
        Changes go live as soon as you save. Signed-in visitors see personal sections mixed into the layout below; anonymous visitors see only the "everyone" blocks.
      </p>
      <CoverStoryPanel initial={config.coverStory} refs={refs} addRef={addRef} />
      <SectionsPanel initial={config.sections.items} builtins={data.builtins} refs={refs} addRef={addRef} />
      <ChartPanel initial={config.chart} refs={refs} addRef={addRef} />
      <TickerPanel initial={config.ticker} refs={refs} addRef={addRef} />
      <AnnouncementPanel initial={config.announcement} />
      <IssuePanel initial={config.issue} />
    </div>
  );
}
