import { useSearchParams } from 'react-router-dom';
import { useArtists, useGenres, useRegions } from '../lib/queries';
import { ArtistTile } from '../components/Cards';
import { Empty, ErrorState, FilterChips, Pagination, Spinner } from '../components/ui';

export function ArtistsPage() {
  const [params, setParams] = useSearchParams();
  const genre = params.get('genre') ?? undefined;
  const region = params.get('region') ?? undefined;
  const sort = params.get('sort') ?? 'trending';
  const type = params.get('type') ?? 'all';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);

  const genres = useGenres();
  const regions = useRegions();
  const { data, isLoading, error, refetch, isFetching } = useArtists({ genre, region, sort, q, page, limit: 24, ...(type !== 'all' && { type }) });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl md:text-7xl">Artists</h1>
          <p className="mt-2 text-muted">The voices shaping Indian hip hop, from every corner of the country.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            className="input min-w-0 flex-1 sm:!w-52 sm:flex-none"
            placeholder="Filter by name"
            defaultValue={q}
            onChange={(e) => update({ q: e.target.value })}
            aria-label="Filter artists by name"
          />
          <select className="input !w-auto" value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort artists">
            <option value="trending">Trending (7 days)</option>
            <option value="popular">Most followed</option>
            <option value="name">A–Z</option>
            <option value="new">Recently added</option>
          </select>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs font-semibold tracking-wider text-dim uppercase">Who</span>
        <div className="flex gap-2">
          {[
            { value: 'all', label: 'Everyone' },
            { value: 'solo', label: 'Solo' },
            { value: 'group', label: 'Groups & crews' },
          ].map((t) => (
            <button key={t.value} className={`chip ${type === t.value ? 'chip-active' : ''}`} onClick={() => update({ type: t.value === 'all' ? undefined : t.value })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-3 flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs font-semibold tracking-wider text-dim uppercase">Sound</span>
        <FilterChips items={genres.data?.items ?? []} value={genre} onChange={(v) => update({ genre: v })} />
      </div>
      <div className="mb-8 flex items-center gap-3">
        <span className="w-16 shrink-0 text-xs font-semibold tracking-wider text-dim uppercase">City</span>
        <FilterChips items={regions.data?.items ?? []} value={region} onChange={(v) => update({ region: v })} allLabel="Everywhere" />
      </div>

      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorState error={error} retry={refetch} />
      ) : data.items.length === 0 ? (
        <Empty title="No artists found">Try a different filter.</Empty>
      ) : (
        <>
          <div className={`grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 ${isFetching ? 'opacity-70' : ''}`}>
            {data.items.map((a, i) => (
              <ArtistTile key={a.id} artist={a} rank={sort === 'trending' && !q && !genre && !region ? (page - 1) * 24 + i + 1 : undefined} />
            ))}
          </div>
          <Pagination meta={data.meta} onPage={(p) => update({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
