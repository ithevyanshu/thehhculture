import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api';
import type { PageMeta } from '../lib/types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid place-items-center py-24" role="status">
      <Loader2 className="animate-spin" size={28} />
      <span className="mono mt-3 text-muted">{label}…</span>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <div className="py-24 text-center">
      <p className="display text-8xl">
        <span className="highlight">{notFound ? '404' : 'Oops'}</span>
      </p>
      <p className="mono mt-4 text-muted">{error instanceof Error ? error.message : 'Something went wrong'}</p>
      <div className="mt-8 flex justify-center gap-3">
        {retry && !notFound && (
          <button onClick={retry} className="btn-ghost">
            Try again
          </button>
        )}
        <Link to="/" className="btn-primary">
          Back to the front page
        </Link>
      </div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="border-2 border-dashed border-ink/40 px-6 py-12 text-center">
      <p className="display text-3xl">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Zine section masthead: kicker, big headline, heavy rule. */
export function SectionHeader({
  title,
  subtitle,
  kicker,
  action,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 border-b-[3px] border-ink pb-2">
      <div className="min-w-0">
        {kicker && <p className="mono mb-1 text-saffron-soft">{kicker}</p>}
        <h2 className="display text-4xl md:text-5xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted italic">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0 pb-1">{action}</div>}
    </div>
  );
}

export function SeeAll({ to, label = 'See all' }: { to: string; label?: string }) {
  return (
    <Link to={to} className="mono group inline-flex items-center gap-1 hover:text-saffron-soft">
      {label} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Titled grid of cards (the zine lays things out on the page instead of scrolling sideways). */
export function Shelf({
  title,
  subtitle,
  kicker,
  seeAllTo,
  children,
  cols = 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6',
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  seeAllTo?: string;
  children: ReactNode[];
  cols?: string;
}) {
  return (
    <section className="mb-16">
      <SectionHeader title={title} subtitle={subtitle} kicker={kicker} action={seeAllTo && <SeeAll to={seeAllTo} />} />
      <div className={`grid gap-x-5 gap-y-8 ${cols}`}>{children}</div>
    </section>
  );
}

export function Pagination({ meta, onPage }: { meta: PageMeta; onPage: (page: number) => void }) {
  if (meta.totalPages <= 1) return null;
  return (
    <div className="mt-8 flex items-center justify-center gap-3">
      <button className="btn-ghost !px-3" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)} aria-label="Previous page">
        <ChevronLeft size={16} />
      </button>
      <span className="mono text-muted">
        Page {meta.page} / {meta.totalPages}
      </span>
      <button
        className="btn-ghost !px-3"
        disabled={meta.page >= meta.totalPages}
        onClick={() => onPage(meta.page + 1)}
        aria-label="Next page"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function FilterChips<T extends { slug: string; name: string }>({
  items,
  value,
  onChange,
  allLabel = 'All',
}: {
  items: T[];
  value: string | undefined;
  onChange: (slug: string | undefined) => void;
  allLabel?: string;
}) {
  return (
    <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
      <button className={`chip shrink-0 ${!value ? 'chip-active' : ''}`} onClick={() => onChange(undefined)}>
        {allLabel}
      </button>
      {items.map((it) => (
        <button
          key={it.slug}
          className={`chip shrink-0 ${value === it.slug ? 'chip-active' : ''}`}
          onClick={() => onChange(value === it.slug ? undefined : it.slug)}
        >
          {it.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Poster headline that scales so its longest word always fits the column
 * (no mid-word breaks for names like HANUMANKIND), capped at `maxRem`.
 */
export function FitTitle({ text, maxRem = 9, className = '' }: { text: string; maxRem?: number; className?: string }) {
  const longest = Math.max(4, ...text.split(/\s+/).map((w) => w.length));
  // Anton caps average ~0.5em wide; small safety margin.
  return (
    <div className="[container-type:inline-size]">
      <h1 className={`display ${className}`} style={{ fontSize: `min(${maxRem}rem, calc(100cqw / ${longest * 0.53}))` }}>
        {text}
      </h1>
    </div>
  );
}

/** Spot colours used for genre/scene blocks. */
export const SPOT_COLORS = ['#f05a0a', '#d9f24a', '#d62839', '#16130f', '#2b4c7e', '#e8e0cf'];
export const spotText = (bg: string) => (['#16130f', '#d62839', '#2b4c7e'].includes(bg) ? '#f2ecdf' : '#16130f');
