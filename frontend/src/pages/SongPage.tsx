import { Link, useParams } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { useSong } from '../lib/queries';
import { at, duration, year } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { ArtistCredits, SongRow } from '../components/Cards';
import { AddToPlaylistButton, LikeButton } from '../components/Buttons';
import { EmbedPlayer } from '../components/EmbedPlayer';
import { MissingHere, useSuggest } from '../components/Suggest';
import { ErrorState, FitTitle, SectionHeader, Spinner } from '../components/ui';

export function SongPage() {
  const openSuggest = useSuggest();
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useSong(slug);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  const { song, moreFromArtist, similar } = data;
  const cover = song.coverUrl ?? song.album?.coverUrl;
  const meta = [
    year(song.releaseDate),
    duration(song.durationSec),
    song.album ? null : 'Single',
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl">
      <section className="mb-12 flex flex-col gap-10 md:flex-row md:items-end">
        <div className="group relative w-60 shrink-0 md:w-80">
          <div className="-rotate-1 border-2 border-ink bg-surface shadow-hard">
            <Artwork src={cover} name={song.title} seed={song.slug} live />
          </div>
          <span className="sticker absolute -top-3 -left-3 z-10">Track</span>
        </div>
        <div className="min-w-0">
          <p className="mono text-saffron-soft">Liner notes</p>
          <FitTitle text={song.title} maxRem={6.5} className="mt-2" />
          <p className="mt-3 text-xl font-bold uppercase">
            <ArtistCredits artist={song.artist} features={song.features} className="!text-xl !text-ink" />
          </p>
          {!!song.producers?.length && (
            <p className="mono mt-2">
              Prod.{' '}
              {song.producers.map(({ artist: p }, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link to={`/artists/${p.slug}`} className="text-saffron-soft underline decoration-2 underline-offset-2 hover:text-ink">
                    {at(p)}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <p className="mono mt-2 text-muted">
            {song.album && (
              <>
                from{' '}
                <Link to={`/albums/${song.album.slug}`} className="text-ink underline decoration-2 underline-offset-2 hover:text-saffron-soft">
                  {song.album.title}
                </Link>
                {meta.length ? ' · ' : ''}
              </>
            )}
            {meta.join(' · ')}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {song.genres.map((g) => (
              <Link key={g.slug} to={`/songs?genre=${g.slug}`} className="chip">
                {g.name}
              </Link>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2">
            <LikeButton slug={song.slug} isLiked={song.isLiked} count={song._count.likes} showCount />
            <AddToPlaylistButton songId={song.id} />
            {song.lyricsUrl && (
              <a href={song.lyricsUrl} target="_blank" rel="noreferrer" className="chip">
                Lyrics <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      </section>

      <div className="mb-12">
        <EmbedPlayer song={song} />
      </div>

      <MissingHere
        text={`Wrong credits, missing feature, or a Spotify/YouTube link we should add for "${song.title}"?`}
        onClick={() => openSuggest({ type: 'CORRECTION', message: `About "${song.title}" by ${song.artist.name}: ` })}
      />

      <div className="grid gap-10 lg:grid-cols-2">
        {moreFromArtist.length > 0 && (
          <section>
            <SectionHeader kicker="Same artist" title={`More ${song.artist.name}`} />
            <div className="border-2 border-ink bg-surface px-1 shadow-hard">
              {moreFromArtist.map((s) => (
                <SongRow key={s.id} song={s} showAlbum={false} />
              ))}
            </div>
          </section>
        )}
        {similar.length > 0 && (
          <section>
            <SectionHeader kicker="If you like this" title="Similar sound" />
            <div className="border-2 border-ink bg-surface px-1 shadow-hard">
              {similar.map((s) => (
                <SongRow key={s.id} song={s} showAlbum={false} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
