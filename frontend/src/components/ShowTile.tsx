import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { Artwork } from './Artwork';
import { at } from '../lib/format';
import type { ShowCard } from '../lib/types';

/** Poster-style card for a rap show with its latest winner. */
export function ShowTile({ show }: { show: ShowCard }) {
  const latest = show.latestSeason;
  const winners = latest?.cast.map((c) => c.artist) ?? [];
  return (
    <Link
      to={`/shows/${show.slug}`}
      className="group flex h-full flex-col border-2 border-ink bg-ink text-paper shadow-hard transition hover:-translate-y-1 hover:shadow-hard-saffron"
    >
      <div className="flex items-start justify-between gap-3 border-b-2 border-paper/20 p-4">
        <div className="min-w-0">
          <p className="mono text-saffron">{show.network ?? 'Rap show'}</p>
          <h3 className="display mt-1 text-4xl break-words">{show.name}</h3>
        </div>
        <span className="mono shrink-0 border-2 border-paper px-1.5 py-0.5">{show._count.seasons} S</span>
      </div>
      <div className="flex flex-1 items-center gap-3 p-4">
        {winners.length ? (
          <>
            <div className="w-16 shrink-0 border-2 border-paper">
              <Artwork src={winners[0].imageUrl} name={winners[0].name} seed={winners[0].slug} />
            </div>
            <div className="min-w-0">
              <p className="mono flex items-center gap-1 text-saffron">
                <Trophy size={12} /> Season {latest!.number} winner{winners.length > 1 ? 's' : ''}
              </p>
              <p className="display truncate text-2xl">{winners.map((w) => w.name).join(' & ')}</p>
              <p className="mono !normal-case text-paper/60">{at(winners[0])}</p>
            </div>
          </>
        ) : (
          <p className="mono text-paper/60">{latest ? `Season ${latest.number}, winner TBA` : 'Seasons coming soon'}</p>
        )}
      </div>
    </Link>
  );
}
