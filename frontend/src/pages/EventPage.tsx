import { Link, useParams } from 'react-router-dom';
import { CalendarDays, ExternalLink, MapPin, Ticket } from 'lucide-react';
import { useEvent } from '../lib/queries';
import { Artwork } from '../components/Artwork';
import { EventRow, EventStatusTag } from '../components/EventCards';
import { ErrorState, FitTitle, SectionHeader, Spinner } from '../components/ui';
import { at, eventCountdown, eventDay, eventTime, eventWhen } from '../lib/format';
import type { ArtistRef } from '../lib/types';

/** The lineup carries only an artist reference, so this is deliberately lighter than ArtistTile. */
function LineupTile({ artist, billing }: { artist: ArtistRef; billing: string | null }) {
  return (
    <Link to={`/artists/${artist.slug}`} className="group block">
      <div className="relative aspect-square border-2 border-ink shadow-hard transition group-hover:-translate-y-0.5">
        <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} />
        {billing && <span className="sticker absolute -top-2 -left-2 !bg-saffron !text-paper">{billing}</span>}
      </div>
      <h3 className="mt-2 truncate font-bold uppercase group-hover:underline">{artist.name}</h3>
      <p className="mono truncate text-muted">{at(artist)}</p>
    </Link>
  );
}

export function EventPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useEvent(slug);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  const { event, related } = data;
  const countdown = event.status === 'SCHEDULED' ? eventCountdown(event.startsAt) : null;
  const where = [event.venue, event.address, event.region?.name].filter(Boolean).join(', ');
  const headliner = event.lineup[0]?.artist;
  const mapsUrl = where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : null;

  return (
    <div>
      <section className="mb-14 grid items-start gap-8 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="relative mx-auto w-64 md:mx-0 md:w-full">
          <div className="tape relative rotate-[-2deg] border border-ink/10 bg-surface p-3 pb-4 shadow-hard">
            <Artwork src={event.posterUrl} name={event.title} seed={event.slug} live />
          </div>
          {countdown && <span className="sticker absolute -right-3 -bottom-3 z-10 !bg-neon">{countdown}</span>}
        </div>

        <div className="min-w-0">
          <div className="mono flex flex-wrap items-center gap-2 text-saffron-soft">
            <CalendarDays size={13} /> {eventWhen(event)}
            {event.kind && <span className="text-muted">· {event.kind}</span>}
            <EventStatusTag status={event.status} />
          </div>
          <FitTitle text={event.title} maxRem={8} className="mt-2" />

          {where && (
            <p className="mono mt-4 flex items-start gap-1.5 text-muted">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              {mapsUrl ? (
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="hover:underline">
                  {where} <ExternalLink size={11} className="inline" />
                </a>
              ) : (
                where
              )}
            </p>
          )}

          {event.status === 'CANCELLED' ? (
            <p className="mt-6 border-2 border-red bg-red/10 px-3 py-2 text-sm text-red">This one is off. Tickets should be refunded by whoever sold them.</p>
          ) : (
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {event.ticketUrl && (
                <a href={event.ticketUrl} target="_blank" rel="noreferrer" className="btn-primary">
                  <Ticket size={14} /> Get tickets
                </a>
              )}
              {event.priceFrom !== null && <span className="mono text-muted">from ₹{event.priceFrom}</span>}
              {event.status === 'POSTPONED' && <span className="mono text-muted">New date to be announced</span>}
            </div>
          )}

          {!event.allDay && (
            <p className="mono mt-4 text-dim">
              Doors {eventTime(event.startsAt)}
              {event.endsAt && ` · until ${eventDay(event.endsAt)}`}
            </p>
          )}
        </div>
      </section>

      {event.description && (
        <section className="mb-14 max-w-3xl">
          <SectionHeader title="What it is" />
          <p className="mt-3 text-lg whitespace-pre-wrap">{event.description}</p>
        </section>
      )}

      {!!event.lineup.length && (
        <section className="mb-14">
          <SectionHeader title="Line-up" subtitle={headliner ? `${headliner.name} headlining` : undefined} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {event.lineup.map((l, i) => (
              <LineupTile key={l.artist.id} artist={l.artist} billing={i === 0 ? 'Headliner' : null} />
            ))}
          </div>
        </section>
      )}

      {!!related.length && (
        <section className="mb-14">
          <SectionHeader title="Also coming up" subtitle="Other dates with these artists" />
          <div className="mt-3 border-2 border-ink bg-surface shadow-hard">
            {related.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </div>
        </section>
      )}

      <Link to="/events" className="mono hover:underline">
        ← All events
      </Link>
    </div>
  );
}
