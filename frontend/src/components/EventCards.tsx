import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Ticket } from 'lucide-react';
import { Artwork } from './Artwork';
import { eventCountdown, eventDay, eventTime, eventWhen } from '../lib/format';
import type { EventCard as Event } from '../lib/types';

/** Cancelled and postponed nights stay listed, but say so loudly. */
export function EventStatusTag({ status }: { status: Event['status'] }) {
  if (status === 'SCHEDULED') return null;
  return (
    <span className={`mono border-2 border-ink px-1.5 py-0.5 ${status === 'CANCELLED' ? 'bg-red text-paper' : 'bg-neon'}`}>
      {status === 'CANCELLED' ? 'Cancelled' : 'Postponed'}
    </span>
  );
}

/** The date as a torn-off calendar block: big day number over the month. */
function DateBlock({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <div className="flex size-14 shrink-0 flex-col items-center justify-center border-2 border-ink bg-paper leading-none">
      <span className="display text-2xl">{d.getDate()}</span>
      <span className="mono !text-[10px] uppercase text-muted">{d.toLocaleDateString('en-IN', { month: 'short' })}</span>
    </div>
  );
}

const lineupNames = (e: Event) => e.lineup.map((l) => l.artist.name);

/** Poster tile, for grids and the home shelf. */
export function EventTile({ event }: { event: Event }) {
  const countdown = event.status === 'SCHEDULED' ? eventCountdown(event.startsAt) : null;
  const names = lineupNames(event);
  return (
    <Link to={`/events/${event.slug}`} className="group block">
      <div className="relative border-2 border-ink bg-surface shadow-hard transition group-hover:-translate-y-0.5">
        <div className="aspect-[3/4] overflow-hidden border-b-2 border-ink">
          <Artwork src={event.posterUrl} name={event.title} seed={event.slug} />
        </div>
        {countdown && <span className="sticker absolute -top-2 -right-2 !bg-neon">{countdown}</span>}
        <div className="p-3">
          <p className="mono flex items-center gap-1 text-saffron-soft">
            <CalendarDays size={11} /> {eventWhen(event)}
          </p>
          <h3 className="mt-1 line-clamp-2 font-bold uppercase group-hover:underline">{event.title}</h3>
          {(event.venue || event.region) && (
            <p className="mono mt-1 flex items-center gap-1 truncate text-muted">
              <MapPin size={11} className="shrink-0" /> {[event.venue, event.region?.name].filter(Boolean).join(', ')}
            </p>
          )}
          {!!names.length && <p className="mt-1 truncate text-sm text-muted">{names.join(' · ')}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <EventStatusTag status={event.status} />
            {event.priceFrom !== null && <span className="mono text-dim">from ₹{event.priceFrom}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

/** Dense row, for the listing page and the artist page. */
export function EventRow({ event }: { event: Event }) {
  const names = lineupNames(event);
  return (
    <Link
      to={`/events/${event.slug}`}
      className="flex items-center gap-4 border-b border-dashed border-ink/25 px-3 py-3 transition last:border-b-0 hover:bg-neon/40"
    >
      <DateBlock iso={event.startsAt} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-bold uppercase">{event.title}</h3>
          <EventStatusTag status={event.status} />
          {event.kind && <span className="mono text-dim">{event.kind}</span>}
        </div>
        <p className="mono truncate text-muted">
          {event.allDay ? eventDay(event.startsAt) : eventTime(event.startsAt)}
          {(event.venue || event.region) && ` · ${[event.venue, event.region?.name].filter(Boolean).join(', ')}`}
        </p>
        {!!names.length && <p className="truncate text-sm text-muted">{names.join(' · ')}</p>}
      </div>
      {event.ticketUrl && event.status !== 'CANCELLED' && (
        <span className="mono hidden shrink-0 items-center gap-1 border-2 border-ink bg-surface px-2 py-1 sm:flex">
          <Ticket size={12} /> Tickets
        </span>
      )}
    </Link>
  );
}
