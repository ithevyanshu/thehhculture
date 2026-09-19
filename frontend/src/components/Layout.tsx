import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LogOut, Search, Settings, Shield, User as UserIcon, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useSite } from '../lib/queries';
import type { Tone } from '../lib/types';
import { issueDate, issueNumber } from '../lib/format';
import { Artwork } from './Artwork';
import { Wordmark } from './Wordmark';
import { SmartLink } from './SmartLink';
import { FloatingSuggestButton, SuggestProvider, useSuggest } from './Suggest';

const nav = [
  { to: '/', label: 'Front page', end: true },
  { to: '/artists', label: 'Artists' },
  { to: '/songs', label: 'Songs' },
  { to: '/scenes', label: 'Scenes' },
  { to: '/shows', label: 'Shows' },
  { to: '/library', label: 'Library' },
];

function Logo() {
  return (
    <Link to="/" className="shrink-0 transition hover:opacity-80" aria-label="DHH Culture front page">
      <Wordmark className="text-xl sm:text-2xl" />
    </Link>
  );
}

function SearchBox() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const location = useLocation();
  const [q, setQ] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '');

  useEffect(() => {
    if (location.pathname !== '/search') setQ('');
  }, [location.pathname]);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="relative w-full max-w-xs"
    >
      <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (location.pathname === '/search') navigate(`/search?q=${encodeURIComponent(e.target.value)}`, { replace: true });
        }}
        placeholder="Search the scene…"
        className="input !py-2 !pl-9"
        aria-label="Search"
      />
    </form>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link to="/login" className="btn-ghost !px-3 !py-2">
          Log in
        </Link>
        <Link to="/register" className="btn-primary hidden !px-3 !py-2 sm:inline-flex">
          Join
        </Link>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 border-2 border-ink bg-surface p-1 pr-3 transition hover:shadow-hard-sm"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="size-7">
          <Artwork src={user.avatarUrl} name={user.displayName} seed={user.username} live />
        </div>
        <span className="mono hidden sm:inline">{user.displayName}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 border-2 border-ink bg-surface p-1.5 shadow-hard">
          <p className="mono truncate px-3 py-2 text-muted">@{user.username}</p>
          <MenuLink to="/library" icon={<UserIcon size={16} />} label="Your library" />
          <MenuLink to="/settings" icon={<Settings size={16} />} label="Settings & taste" />
          {user.role === 'ADMIN' && <MenuLink to="/admin" icon={<Shield size={16} />} label="Admin panel" />}
          <button
            onClick={async () => {
              await logout();
              navigate('/');
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm font-semibold text-red hover:bg-neon"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} role="menuitem" className="flex items-center gap-2.5 px-3 py-2 text-sm font-semibold hover:bg-neon">
      {icon} {label}
    </Link>
  );
}

const TONES: Record<Tone, string> = {
  saffron: 'bg-saffron text-ink',
  ink: 'bg-ink text-paper',
  red: 'bg-red text-paper',
  neon: 'bg-neon text-ink',
};

/** Admin-controlled site-wide banner (dismissible per browser session). */
function Announcement() {
  const { data } = useSite();
  const a = data?.announcement;
  const storageKey = a ? `dhh-banner-dismissed:${a.text}` : '';
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!storageKey && sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      setDismissed(!!storageKey && sessionStorage.getItem(storageKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [storageKey]);

  if (!a || dismissed) return null;
  return (
    <div className={`mono relative flex items-center justify-center gap-3 border-b-2 border-ink px-10 py-2 text-center ${TONES[a.tone]}`}>
      <span>{a.text}</span>
      {a.linkUrl && (
        <SmartLink href={a.linkUrl} className="underline decoration-2 underline-offset-2 hover:no-underline">
          {a.linkLabel || 'Read more'} →
        </SmartLink>
      )}
      <button
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(storageKey, '1');
          } catch {
            /* storage unavailable: dismiss for this page view only */
          }
        }}
        className="absolute right-3 p-1 hover:opacity-70"
        aria-label="Dismiss announcement"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** Scrolling strip under the masthead: latest drops, or the admin's hand-picked items. */
/** Strip colour + label chip that contrasts with it. */
const TICKER_TONES: Record<Tone, { strip: string; label: string; star: string }> = {
  ink: { strip: 'bg-ink text-paper', label: 'bg-saffron text-ink', star: 'text-saffron' },
  saffron: { strip: 'bg-saffron text-ink', label: 'bg-ink text-paper', star: 'text-ink' },
  red: { strip: 'bg-red text-paper', label: 'bg-ink text-paper', star: 'text-neon' },
  neon: { strip: 'bg-neon text-ink', label: 'bg-ink text-paper', star: 'text-saffron-soft' },
};
/** Seconds per item, so long and short tickers scroll at the same pace. */
const TICKER_PACE = { slow: 6, normal: 4, fast: 2.5 } as const;

function Ticker() {
  const { data } = useSite();
  const ticker = data?.ticker;
  if (data && !ticker) return null; // hidden by admin
  if (!ticker?.items.length) return <div className="h-9 border-b-[3px] border-ink bg-ink" />;
  const tone = TICKER_TONES[ticker.tone] ?? TICKER_TONES.ink;
  const duration = Math.max(20, ticker.items.length * TICKER_PACE[ticker.speed ?? 'normal']);

  const items = (copy: string) =>
    ticker.items.map((item, i) => {
      const key = `${copy}-${i}`;
      const tabIndex = copy === 'b' ? -1 : undefined;
      const cls = 'mx-6 inline-flex items-center gap-2 whitespace-nowrap hover:underline';
      const star = <span className={tone.star}>✦</span>;
      if (item.type === 'text') {
        const body = (
          <>
            {star}
            <span className="font-bold">{item.text}</span>
          </>
        );
        return item.linkUrl ? (
          <SmartLink key={key} href={item.linkUrl} className={cls} tabIndex={tabIndex}>
            {body}
          </SmartLink>
        ) : (
          <span key={key} className={cls}>
            {body}
          </span>
        );
      }
      if (item.type === 'artist' || item.type === 'show') {
        const target = item.type === 'artist' ? item.artist : item.show;
        return (
          <Link key={key} to={`/${item.type}s/${target.slug}`} tabIndex={tabIndex} className={cls}>
            {star}
            <span className="opacity-60">{item.type === 'artist' ? 'Artist' : 'Show'}</span>
            <span className="font-bold">{target.name}</span>
          </Link>
        );
      }
      return (
        <Link key={key} to={`/songs/${item.song.slug}`} tabIndex={tabIndex} className={cls}>
          {star}
          <span className="font-bold">{item.song.artist.name}</span>
          <span className="opacity-60">/</span>
          <span>{item.song.title}</span>
        </Link>
      );
    });
  return (
    <div className={`mono flex h-9 items-center overflow-hidden border-b-[3px] border-ink ${tone.strip}`}>
      <span className={`z-10 flex h-full shrink-0 items-center px-3 ${tone.label}`}>{ticker.label}</span>
      <div className="relative flex-1 overflow-hidden">
        {/* Two identical copies + translateX(-50%) = seamless loop */}
        <div className="animate-ticker flex w-max hover:[animation-play-state:paused]" style={{ animationDuration: `${duration}s` }}>
          {items('a')}
          <div aria-hidden className="flex">
            {items('b')}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const links = user?.role === 'ADMIN' ? [...nav, { to: '/admin', label: 'Admin', end: false }] : nav;

  return (
    <SuggestProvider>
    <div className="flex min-h-screen flex-col">
      <Announcement />
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 md:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `mono px-3 py-2 transition ${isActive ? 'bg-ink text-paper' : 'hover:bg-neon'}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden flex-1 justify-end md:flex">
            <SearchBox />
          </div>
          <div className="ml-auto md:ml-0">
            <UserMenu />
          </div>
        </div>
        {/* Mobile / tablet nav row */}
        <nav className="scrollbar-none flex gap-1.5 overflow-x-auto border-t-2 border-ink px-4 py-2 lg:hidden">
          {[...links, { to: '/search', label: 'Search', end: false }].map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `mono shrink-0 border-2 border-ink px-3 py-1 ${isActive ? 'bg-ink text-paper' : 'bg-surface'}`}
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <Ticker />
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pt-8 pb-20 md:px-8">
        <Outlet />
      </main>

      <footer className="border-t-[3px] border-ink bg-ink text-paper">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 md:flex-row md:items-end md:justify-between md:px-8">
          <div>
            <Wordmark inverted className="text-3xl md:text-4xl" />
            <p className="display mt-4 text-5xl md:text-6xl">
              From the <span className="text-saffron">street</span>
              <br />
              to the globe.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <div className="md:text-right">
              <p className="mono text-paper/60">Contact / press / submissions</p>
              <a
                href="mailto:thedesihiphopculture@gmail.com"
                className="mt-1 inline-block text-lg font-bold break-all text-saffron underline decoration-2 underline-offset-4 hover:text-paper"
              >
                thedesihiphopculture@gmail.com
              </a>
            </div>
            <FooterSuggestLink />
            <p className="mono text-paper/60">
              DHH/CULTURE · Issue #{issueNumber()} · {issueDate()} · Printed on the internet
            </p>
          </div>
        </div>
        <div className="border-t-2 border-paper/15">
          <p className="mono mx-auto max-w-7xl px-4 py-4 !text-[10px] text-paper/50 md:px-8">
            © {new Date().getFullYear()} DHH/CULTURE. All rights reserved. Artist names, photos and music belong to their respective owners.
          </p>
        </div>
      </footer>
      <FloatingSuggestButton />
    </div>
    </SuggestProvider>
  );
}

function FooterSuggestLink() {
  const openSuggest = useSuggest();
  return (
    <button
      onClick={() => openSuggest({ type: 'FEATURE' })}
      className="mono group inline-flex items-center gap-2 self-start border-2 border-paper px-3 py-2 text-paper transition hover:bg-saffron hover:text-ink md:self-end"
    >
      Something missing? <span className="text-saffron group-hover:text-ink">Suggest it</span> →
    </button>
  );
}
