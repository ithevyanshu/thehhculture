import { Link, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { useShow, useShows } from '../lib/queries';
import { Artwork } from '../components/Artwork';
import { at } from '../lib/format';
import { ArtistTile } from '../components/Cards';
import { ShowTile } from '../components/ShowTile';
import { Empty, ErrorState, FitTitle, SectionHeader, Spinner } from '../components/ui';
import { SHOW_ROLE_LABEL, type ShowRole, type ShowSeason } from '../lib/types';

export function ShowsPage() {
  const { data, isLoading, error, refetch } = useShows();
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  return (
    <div>
      <p className="mono text-saffron-soft">On screen</p>
      <h1 className="display text-7xl md:text-9xl">Rap shows</h1>
      <p className="mt-3 mb-12 max-w-xl text-lg">
        The battles, cyphers and reality shows that put new names on the map, and who took the crown each season.
      </p>
      {data.items.length ? (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((s) => (
            <ShowTile key={s.id} show={s} />
          ))}
        </div>
      ) : (
        <Empty title="No shows yet" />
      )}
    </div>
  );
}

const PODIUM: ShowRole[] = ['WINNER', 'RUNNER_UP', 'FINALIST'];
const PANEL: ShowRole[] = ['JUDGE', 'GUEST_JUDGE', 'HOST'];

function Season({ season }: { season: ShowSeason }) {
  const podium = season.cast.filter((c) => PODIUM.includes(c.role));
  const panel = season.cast.filter((c) => PANEL.includes(c.role));
  const contestants = season.cast.filter((c) => c.role === 'CONTESTANT');
  // Showcase formats (64 Bars): each featured artist with their track.
  const featured = season.cast.filter((c) => c.role === 'FEATURED');

  return (
    <section className="mb-16" id={`season-${season.number}`}>
      <SectionHeader
        kicker={[season.year, season.title].filter(Boolean).join(' · ') || undefined}
        title={`Season ${season.number}`}
      />

      {podium.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-5">
          {podium.map((c) => (
            <div key={c.artist.id + c.role} className="relative">
              <span
                className={`mono absolute -top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 border-2 border-ink px-2 py-0.5 whitespace-nowrap shadow-hard-sm ${
                  c.role === 'WINNER' ? 'bg-saffron' : c.role === 'RUNNER_UP' ? 'bg-neon' : 'bg-surface'
                }`}
              >
                {c.role === 'WINNER' && <Trophy size={12} />} {c.placement ?? SHOW_ROLE_LABEL[c.role]}
              </span>
              <ArtistTile artist={c.artist} />
            </div>
          ))}
        </div>
      )}

      {featured.length > 0 && (
        <div className="mb-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-5">
          {featured.map((c) => (
            <div key={c.artist.id + c.role}>
              <ArtistTile artist={c.artist} />
              {c.placement && <p className="mono mt-1.5 truncate text-saffron-soft" title={c.placement}>“{c.placement}”</p>}
            </div>
          ))}
        </div>
      )}

      {panel.length > 0 && (
        <div className="mb-6">
          <p className="label">Panel</p>
          <div className="flex flex-wrap gap-3">
            {panel.map((c) => (
              <Link
                key={c.artist.id + c.role}
                to={`/artists/${c.artist.slug}`}
                className="flex items-center gap-2 border-2 border-ink bg-surface py-1 pr-3 pl-1 shadow-hard-sm transition hover:bg-neon"
              >
                <div className="size-9 border border-ink">
                  <Artwork src={c.artist.imageUrl} name={c.artist.name} seed={c.artist.slug} live />
                </div>
                <span className="font-bold uppercase">{c.artist.name}</span>
                <span className="mono text-muted">{SHOW_ROLE_LABEL[c.role]}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {contestants.length > 0 && (
        <div>
          <p className="label">Contestants</p>
          <div className="flex flex-wrap gap-2">
            {contestants.map((c) => (
              <Link key={c.artist.id} to={`/artists/${c.artist.slug}`} className="chip !normal-case" title={c.artist.name}>
                {at(c.artist)}
                {c.placement && <span className="opacity-60"> · {c.placement}</span>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!season.cast.length && <Empty title="Cast coming soon" />}
    </section>
  );
}

export function ShowPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useShow(slug);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const { show } = data;

  return (
    <div>
      <section className="mb-14 grid items-end gap-8 md:grid-cols-[minmax(0,280px)_1fr]">
        {show.logoUrl && (
          <div className="mx-auto w-56 -rotate-2 border-2 border-ink bg-surface p-2 shadow-hard md:mx-0 md:w-full">
            <Artwork src={show.logoUrl} name={show.name} live />
          </div>
        )}
        <div className={`min-w-0 ${show.logoUrl ? '' : 'md:col-span-2'}`}>
          <p className="mono text-saffron-soft">
            <Link to="/shows" className="hover:underline">
              Rap shows
            </Link>{' '}
            · {show.network ?? 'Show'} · {show.seasons.length} season{show.seasons.length === 1 ? '' : 's'}
          </p>
          <FitTitle text={show.name} maxRem={9} className="mt-2" />
          {show.description && <p className="mt-4 max-w-2xl text-lg">{show.description}</p>}
          {show.seasons.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {show.seasons.map((s) => (
                <a key={s.id} href={`#season-${s.number}`} className="chip">
                  S{s.number}
                  {s.year ? ` · ${s.year}` : ''}
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      {show.seasons.length ? show.seasons.map((s) => <Season key={s.id} season={s} />) : <Empty title="Seasons coming soon" />}
    </div>
  );
}
