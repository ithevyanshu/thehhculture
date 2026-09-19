import { Link, useParams } from 'react-router-dom';
import { useAlbum } from '../lib/queries';
import { plural, year } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { AlbumTile, SongRow } from '../components/Cards';
import { Empty, ErrorState, FitTitle, Shelf, Spinner } from '../components/ui';

export function AlbumPage() {
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useAlbum(slug);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const { album, moreAlbums } = data;

  return (
    <div className="mx-auto max-w-6xl">
      <section className="mb-12 flex flex-col gap-8 md:flex-row md:items-end">
        <div className="relative w-60 shrink-0 md:w-80">
          <div className="rotate-1 border-2 border-ink bg-surface shadow-hard">
            <Artwork src={album.coverUrl} name={album.title} seed={album.slug} live />
          </div>
        </div>
        <div className="min-w-0">
          <span className="sticker">{album.type}</span>
          <FitTitle text={album.title} maxRem={6.5} className="mt-4" />
          <p className="mono mt-3 text-muted">
            <Link to={`/artists/${album.artist.slug}`} className="text-ink underline decoration-2 underline-offset-2 hover:text-saffron-soft">
              {album.artist.name}
            </Link>
            {' · '}
            {[year(album.releaseDate), plural(album._count.songs, 'song')].filter(Boolean).join(' · ')}
          </p>
        </div>
      </section>

      <section className="mb-12">
        {album.songs.length ? (
          <div className="border-2 border-ink bg-surface px-1 shadow-hard">
            {album.songs.map((s, i) => (
              <SongRow key={s.id} song={s} index={s.trackNumber ?? i + 1} showAlbum={false} />
            ))}
          </div>
        ) : (
          <Empty title="Tracklist coming soon">Songs haven't been added to this release yet.</Empty>
        )}
      </section>

      {moreAlbums.length > 0 && (
        <Shelf kicker="Keep digging" title={`More by ${album.artist.name}`}>{moreAlbums.map((a) => <AlbumTile key={a.id} album={a} />)}</Shelf>
      )}
    </div>
  );
}
