import { useSearchParams } from 'react-router-dom';
import { useEvents, useRegions } from '../lib/queries';
import { EventRow, EventTile } from '../components/EventCards';
import { Empty, ErrorState, FilterChips, Pagination, Spinner } from '../components/ui';

type When = 'upcoming' | 'past';

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const when = (params.get('when') as When) ?? 'upcoming';
  const city = params.get('city') ?? '';
  const page = Number(params.get('page') ?? 1);
  const regions = useRegions();

  const { data, isLoading, error, refetch } = useEvents({ when, page, limit: 24, ...(city && { city }) });

  /** Every control writes to the URL, so a filtered list can be shared and bookmarked. */
  const set = (next: Record<string, string>) => {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) v ? merged.set(k, v) : merged.delete(k);
    if (!('page' in next)) merged.delete('page');
    setParams(merged, { replace: true });
  };

  const items = data?.items ?? [];
  const featured = when === 'upcoming' && page === 1 ? items.filter((e) => e.featured).slice(0, 3) : [];
  const rest = items.filter((e) => !featured.some((f) => f.id === e.id));

  return (
    <div>
      <p className="mono text-saffron-soft">Out there</p>
      <h1 className="display text-7xl md:text-9xl">Events</h1>
      <p className="mt-3 mb-8 max-w-xl text-lg">Gigs, festivals, tour dates and launches. Who's playing, where, and how to get in.</p>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(['upcoming', 'past'] as When[]).map((w) => (
          <button key={w} className={`chip ${when === w ? 'chip-active' : ''}`} onClick={() => set({ when: w === 'upcoming' ? '' : w })}>
            {w === 'upcoming' ? 'Coming up' : 'Been and gone'}
          </button>
        ))}
      </div>

      {!!regions.data?.items.length && (
        <div className="mb-8">
          <FilterChips items={regions.data.items} value={city || undefined} onChange={(slug) => set({ city: slug ?? '' })} allLabel="Every city" />
        </div>
      )}

      {isLoading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState error={error} retry={refetch} />
      ) : !items.length ? (
        <Empty title={when === 'upcoming' ? 'Nothing announced yet' : 'Nothing in the archive yet'}>
          {when === 'upcoming' ? <p>Check back soon, or look through what's already happened.</p> : null}
        </Empty>
      ) : (
        <div className={isLoading ? 'opacity-70' : ''}>
          {!!featured.length && (
            <div className="mb-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {featured.map((e) => (
                <EventTile key={e.id} event={e} />
              ))}
            </div>
          )}
          {!!rest.length && (
            <div className="border-2 border-ink bg-surface shadow-hard">
              {rest.map((e) => (
                <EventRow key={e.id} event={e} />
              ))}
            </div>
          )}
          {data && <Pagination meta={data.meta} onPage={(p) => set({ page: String(p) })} />}
        </div>
      )}
    </div>
  );
}
