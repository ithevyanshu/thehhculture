import { useSearchParams } from 'react-router-dom';
import { useGenres, useRegions, useSongs } from '../lib/queries';
import { SongRow } from '../components/Cards';
import { Empty, ErrorState, FilterChips, Pagination, Spinner } from '../components/ui';

const LIMIT = 30;

export function SongsPage() {
  const [params, setParams] = useSearchParams();
  const genre = params.get('genre') ?? undefined;
  const region = params.get('region') ?? undefined;
  const sort = params.get('sort') ?? 'new';
  const year = params.get('year') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 1);

  const genres = useGenres();
  const regions = useRegions();
  const { data, isLoading, error, refetch, isFetching } = useSongs({ genre, region, sort, year, q, page, limit: LIMIT });

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 2009 }, (_, i) => String(thisYear - i));

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-5xl md:text-7xl">Song catalog</h1>
          <p className="mt-2 text-muted">
            {data ? `${data.meta.total} tracks` : 'Every track'} across the Indian hip hop scene.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <input
            className="input min-w-0 flex-1 sm:!w-52 sm:flex-none"
            placeholder="Title, artist or album"
            defaultValue={q}
            onChange={(e) => update({ q: e.target.value })}
            aria-label="Filter songs"
          />
          <select className="input !w-auto" value={year} onChange={(e) => update({ year: e.target.value })} aria-label="Year">
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          <select className="input !w-auto" value={sort} onChange={(e) => update({ sort: e.target.value })} aria-label="Sort">
            <option value="new">Newest</option>
            <option value="old">Oldest</option>
            <option value="popular">Most liked</option>
            <option value="title">Title A–Z</option>
          </select>
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
        <Empty title="No songs match">Try clearing some filters.</Empty>
      ) : (
        <>
          <div className={`border-2 border-ink bg-surface px-1 shadow-hard ${isFetching ? 'opacity-70' : ''}`}>
            {data.items.map((s, i) => (
              <SongRow key={s.id} song={s} index={(page - 1) * LIMIT + i + 1} />
            ))}
          </div>
          <Pagination meta={data.meta} onPage={(p) => update({ page: String(p) })} />
        </>
      )}
    </div>
  );
}
