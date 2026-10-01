import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useArtists, useGenres, useRegions } from '../lib/queries';
import { Artwork } from '../components/Artwork';
import { ApiError } from '../lib/api';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 py-6 md:grid-cols-2 md:py-16">
      <div className="hidden md:block">
        <p className="display text-8xl leading-[0.85]">
          Real <span className="highlight">hip hop.</span>
          <br />
          Real <span className="text-red">gullies.</span>
          <br />
          Your <span className="text-saffron">issue.</span>
        </p>
        <p className="mt-6 max-w-sm text-lg font-semibold text-muted">
          follow who you rate, save what you replay - we'll print the rest of the scene for you.
        </p>
      </div>
      <div className="tape relative border-2 border-ink bg-surface p-6 shadow-hard md:p-8">
        <h1 className="display text-5xl">{title}</h1>
        <p className="mt-2 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function FieldError({ errors, name }: { errors?: Record<string, string[]>; name: string }) {
  const msg = errors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-pink">{msg}</p> : null;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New here?{' '}
          <Link to={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-saffron hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="identifier">
            Email or username
          </label>
          <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="rounded-none bg-pink/10 px-3 py-2 text-sm text-pink">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

/** Toggles a value in a list of picks. */
const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** A handful of suggestions plus a search box, rather than a wall of every option. */
const SUGGESTED_CITIES = 8;
const SUGGESTED_ARTISTS = 12;

function CityPicker({ value, onChange }: { value: string | null; onChange: (slug: string | null) => void }) {
  const [q, setQ] = useState('');
  const regions = useRegions();
  const all = regions.data?.items ?? [];

  // Biggest scenes first, so the shortlist is the one most people want.
  const ranked = [...all].sort((a, b) => (b._count?.artists ?? 0) - (a._count?.artists ?? 0));
  const query = q.trim().toLowerCase();
  const matches = query ? all.filter((r) => r.name.toLowerCase().includes(query) || (r.state ?? '').toLowerCase().includes(query)).slice(0, 8) : [];
  // Whatever is picked stays visible even when it isn't one of the suggestions.
  const chosen = all.find((r) => r.slug === value);
  const shortlist = ranked.slice(0, SUGGESTED_CITIES);
  const suggestions = chosen && !shortlist.some((r) => r.slug === chosen.slug) ? [chosen, ...shortlist.slice(0, SUGGESTED_CITIES - 1)] : shortlist;

  return (
    <div>
      <span className="label">Your city</span>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((r) => {
          const on = value === r.slug;
          return (
            <button type="button" key={r.slug} onClick={() => onChange(on ? null : r.slug)} aria-pressed={on} className={`chip ${on ? 'chip-active' : ''}`}>
              {r.name}
            </button>
          );
        })}
      </div>
      <div className="relative mt-2 max-w-sm">
        <input
          className="input !py-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Somewhere else? Search ${all.length} cities…`}
          aria-label="Search for your city"
        />
        {!!matches.length && (
          <ul className="absolute z-20 mt-1 w-full border-2 border-ink bg-surface shadow-hard">
            {matches.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neon"
                  onClick={() => {
                    onChange(r.slug);
                    setQ('');
                  }}
                >
                  <b>{r.name}</b>
                  {r.state && <span className="text-muted">{r.state}</span>}
                  <span className="mono ml-auto text-dim">{r._count?.artists ?? 0}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type PickedArtist = { id: string; slug: string; name: string; imageUrl: string | null };

function ArtistPicker({ value, onChange }: { value: PickedArtist[]; onChange: (v: PickedArtist[]) => void }) {
  const [q, setQ] = useState('');
  const popular = useArtists({ sort: 'popular', limit: SUGGESTED_ARTISTS });
  const search = useArtists({ q: q.trim(), limit: 8 }, q.trim().length > 1);

  const has = (id: string) => value.some((a) => a.id === id);
  const toggleArtist = (a: PickedArtist) => onChange(has(a.id) ? value.filter((x) => x.id !== a.id) : [...value, a]);

  // Anything found by search that isn't already in the suggestions, so picks stay on screen.
  const extras = value.filter((a) => !(popular.data?.items ?? []).some((p) => p.id === a.id));

  return (
    <div>
      <span className="label">Artists you rate</span>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {[...(popular.data?.items ?? []), ...extras].map((a) => {
          const on = has(a.id);
          return (
            <button
              type="button"
              key={a.id}
              onClick={() => toggleArtist({ id: a.id, slug: a.slug, name: a.name, imageUrl: a.imageUrl ?? null })}
              aria-pressed={on}
              className="group text-center"
            >
              <div className={`border-2 transition ${on ? 'border-saffron shadow-hard-saffron' : 'border-ink group-hover:-translate-y-0.5'}`}>
                <Artwork src={a.imageUrl} name={a.name} seed={a.slug} />
              </div>
              <span className={`mono mt-1 block truncate !text-[10px] ${on ? 'text-saffron-soft' : 'text-muted'}`}>{a.name}</span>
            </button>
          );
        })}
      </div>

      <div className="relative mt-3 max-w-sm">
        <input
          className="input !py-2"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Someone else? Search by name or @handle…"
          aria-label="Search for an artist"
        />
        {!!q.trim() && !!search.data?.items.length && (
          <ul className="absolute z-20 mt-1 w-full border-2 border-ink bg-surface shadow-hard">
            {search.data.items.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neon"
                  onClick={() => {
                    if (!has(a.id)) onChange([...value, { id: a.id, slug: a.slug, name: a.name, imageUrl: a.imageUrl ?? null }]);
                    setQ('');
                  }}
                >
                  <span className="size-8 shrink-0 border border-ink">
                    <Artwork src={a.imageUrl} name={a.name} seed={a.slug} live />
                  </span>
                  <b className="truncate uppercase">{a.name}</b>
                  {has(a.id) && <span className="mono ml-auto text-dim">added</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-2 text-xs text-dim">
        {value.length ? `Following ${value.length} from day one.` : 'Pick a few — they become the artists you follow.'}
      </p>
    </div>
  );
}

/**
 * Asking to join. The site is invite-only, so this doesn't create a session — it files a
 * request for an admin to accept. The taste questions are asked here rather than after
 * sign-in, so that the moment a request is accepted the person already follows the
 * artists they picked.
 */
export function RegisterPage() {
  const { user, requestInvite } = useAuth();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '', note: '', instagramUrl: '' });
  const [genreSlugs, setGenres] = useState<string[]>([]);
  const [regionSlug, setRegion] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedArtist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const genres = useGenres();

  if (user) return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors(undefined);
    try {
      await requestInvite({
        ...form,
        displayName: form.displayName || undefined,
        note: form.note || undefined,
        instagramUrl: form.instagramUrl || undefined,
        genreSlugs,
        regionSlug,
        artistIds: picked.map((a) => a.id),
      });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details);
      } else setError('Could not send your request');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Request sent" subtitle={<>We'll look at it shortly.</>}>
        <div className="space-y-4 border-2 border-ink bg-surface p-5 shadow-hard">
          <p className="text-lg">
            Thanks. Someone reads every request, so give it a little time. There's no email to wait for — once you're in, just{' '}
            <Link to="/login" className="text-saffron hover:underline">
              sign in
            </Link>{' '}
            with the username and password you chose.
          </p>
          <p className="text-sm text-muted">
            The {picked.length ? `${picked.length} artist${picked.length === 1 ? '' : 's'} you picked will already be` : 'artists you follow will be'}{' '}
            in your feed on day one.
          </p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Ask to join"
      subtitle={
        <>
          DHH/CULTURE is invite only. Already in?{' '}
          <Link to="/login" className="text-saffron hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} required />
            <FieldError errors={fieldErrors} name="email" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="username">
                Username
              </label>
              <input id="username" className="input" autoComplete="username" value={form.username} onChange={set('username')} required minLength={3} maxLength={24} />
              <FieldError errors={fieldErrors} name="username" />
            </div>
            <div>
              <label className="label" htmlFor="displayName">
                Display name
              </label>
              <input id="displayName" className="input" value={form.displayName} onChange={set('displayName')} placeholder="Optional" maxLength={50} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
            />
            <FieldError errors={fieldErrors} name="password" />
            <p className="mt-1 text-xs text-dim">At least 8 characters. This is what you'll sign in with once you're accepted.</p>
          </div>
        </div>

        <div className="space-y-4 border-t-2 border-dashed border-ink/30 pt-5">
          <div>
            <label className="label" htmlFor="instagramUrl">
              Instagram
            </label>
            <input id="instagramUrl" className="input" value={form.instagramUrl} onChange={set('instagramUrl')} placeholder="@yourhandle" maxLength={200} />
            <p className="mt-1 text-xs text-dim">Optional, but it helps us know who's asking.</p>
          </div>
          <div>
            <label className="label" htmlFor="note">
              Why do you want in?
            </label>
            <textarea id="note" className="input min-h-24" value={form.note} onChange={set('note')} maxLength={1000} placeholder="A line or two is plenty." />
          </div>
        </div>

        <div className="space-y-5 border-t-2 border-dashed border-ink/30 pt-5">
          <p className="text-sm text-muted">Tell us what you're into. We'll set your feed up from this the day you're let in.</p>

          <div>
            <span className="label">Sounds</span>
            <div className="flex flex-wrap gap-2">
              {genres.data?.items.map((g) => {
                const on = genreSlugs.includes(g.slug);
                return (
                  <button type="button" key={g.slug} onClick={() => setGenres(toggle(genreSlugs, g.slug))} aria-pressed={on} className={`chip ${on ? 'chip-active' : ''}`}>
                    {g.name}
                  </button>
                );
              })}
            </div>
          </div>

          <CityPicker value={regionSlug} onChange={setRegion} />
          <ArtistPicker value={picked} onChange={setPicked} />
        </div>

        {error && !fieldErrors && <p className="rounded-none bg-pink/10 px-3 py-2 text-sm text-pink">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Ask to join'}
        </button>
      </form>
    </AuthShell>
  );
}
