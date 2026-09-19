import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useDeferredValue } from 'react';
import { useGenres, useSearch } from '../lib/queries';
import { AlbumTile, ArtistTile, SongRow } from '../components/Cards';
import { Empty, SPOT_COLORS, SectionHeader, Spinner, spotText } from '../components/ui';
import { Link } from 'react-router-dom';
import { useSuggest } from '../components/Suggest';

export function SearchPage() {
  const openSuggest = useSuggest();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const deferred = useDeferredValue(q);
  const { data, isFetching } = useSearch(deferred);
  const genres = useGenres();
  const nothing = data && !data.artists.length && !data.songs.length && !data.albums.length;

  return (
    <div className="mx-auto max-w-7xl">
      {/* Mobile search box (desktop uses the header) */}
      <div className="relative mb-8 md:hidden">
        <Search size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })}
          placeholder="Search artists, songs, albums"
          className="input !rounded-full !pl-10"
          aria-label="Search"
        />
      </div>

      {!q.trim() ? (
        <>
          <h1 className="display mb-6 text-5xl md:text-7xl">Search</h1>
          <SectionHeader title="Browse by sound" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {genres.data?.items.map((g, i) => (
              <Link
                key={g.id}
                to={`/songs?genre=${g.slug}`}
                className="flex h-24 items-end border-2 border-ink p-4 shadow-hard-sm transition hover:-translate-y-0.5 hover:shadow-hard"
                style={{ background: SPOT_COLORS[i % SPOT_COLORS.length], color: spotText(SPOT_COLORS[i % SPOT_COLORS.length]) }}
              >
                <span className="display text-3xl">{g.name}</span>
              </Link>
            ))}
          </div>
        </>
      ) : !data && isFetching ? (
        <Spinner />
      ) : nothing ? (
        <Empty title={`Nothing for "${q}"`}>
          <p>Check the spelling, or maybe we just don't have it yet.</p>
          <button
            onClick={() => openSuggest({ type: 'MISSING_ARTIST', message: `Can't find "${q.trim()}" - please add: ` })}
            className="btn-primary mt-5"
          >
            Can't find it? Suggest it
          </button>
        </Empty>
      ) : data ? (
        <div className={isFetching ? 'opacity-70' : ''}>
          <h1 className="display mb-8 text-4xl md:text-5xl">
            Results for <span className="text-saffron">"{q}"</span>
          </h1>
          {data.artists.length > 0 && (
            <section className="mb-12">
              <SectionHeader title="Artists" />
              <div className="grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {data.artists.map((a) => (
                  <ArtistTile key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}
          {data.songs.length > 0 && (
            <section className="mb-12">
              <SectionHeader title="Songs" />
              <div className="border-2 border-ink bg-surface px-1 shadow-hard">
                {data.songs.map((s) => (
                  <SongRow key={s.id} song={s} />
                ))}
              </div>
            </section>
          )}
          {data.albums.length > 0 && (
            <section className="mb-12">
              <SectionHeader title="Albums & mixtapes" />
              <div className="grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {data.albums.map((a) => (
                  <AlbumTile key={a.id} album={a} />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
