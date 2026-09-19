import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BadgeCheck, ExternalLink } from 'lucide-react';
import { useArtist, useArtistSongs } from '../lib/queries';
import { at, compact } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { AlbumTile, ArtistTile, SongRow, SongTile, TrackList } from '../components/Cards';
import { FollowButton } from '../components/Buttons';
import { MissingHere, useSuggest } from '../components/Suggest';
import { InstagramLink } from '../components/Instagram';
import { SHOW_ROLE_LABEL } from '../lib/types';
import { Empty, ErrorState, FitTitle, Pagination, SectionHeader, Shelf, Spinner } from '../components/ui';

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="border-2 border-ink bg-surface px-4 py-2 text-center shadow-hard-sm">
      <p className="display text-4xl leading-none">{compact(value)}</p>
      <p className="mono mt-1 !text-[10px] text-muted">{label}</p>
    </div>
  );
}

function Catalog({ slug }: { slug: string }) {
  const [sort, setSort] = useState('new');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useArtistSongs(slug, { sort, page, limit: 20 });

  return (
    <section className="mb-16">
      <SectionHeader
        kicker="Everything, including features"
        title="Full catalog"
        action={
          <select
            className="input !w-auto !py-1.5"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
            aria-label="Sort catalog"
          >
            <option value="new">Newest</option>
            <option value="old">Oldest</option>
            <option value="popular">Most liked</option>
            <option value="title">Title</option>
          </select>
        }
      />
      {isLoading || !data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <Empty title="No songs yet" />
      ) : (
        <>
          <TrackList>
            {data.items.map((s, i) => (
              <SongRow key={s.id} song={s} index={(page - 1) * 20 + i + 1} />
            ))}
          </TrackList>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </section>
  );
}

export function ArtistPage() {
  const openSuggest = useSuggest();
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useArtist(slug);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  const { artist, topSongs, featuredOn, related, produced, appearances } = data;
  const links = [
    { href: artist.spotifyUrl, label: 'Spotify' },
    { href: artist.youtubeUrl, label: 'YouTube' },
  ].filter((l): l is { href: string; label: string } => !!l.href);

  const byline = [
    at(artist),
    artist.isProducer && 'Producer',
    artist.realName && `a.k.a. ${artist.realName}`,
    artist.region?.name,
    artist.activeSince && `est. ${artist.activeSince}`,
  ].filter(Boolean);

  return (
    <div>
      {/* Poster header: photo pinned left, name set huge */}
      <section className="mb-14 grid items-end gap-8 md:grid-cols-[minmax(0,340px)_1fr]">
        <div className="relative mx-auto w-64 md:mx-0 md:w-full">
          <div className="tape relative rotate-[-2deg] border border-ink/10 bg-surface p-3 pb-4 shadow-hard">
            <Artwork
              src={artist.imageUrl}
              name={artist.name}
              seed={artist.slug}
              live
              title={artist.imageCredit ? `Photo: ${artist.imageCredit}` : undefined}
            />
          </div>
          {artist.verified && (
            <span className="sticker absolute -right-3 -bottom-3 z-10 flex items-center gap-1 !bg-saffron">
              <BadgeCheck size={16} /> Verified
            </span>
          )}
        </div>

        <div className="min-w-0">
          <p className="mono text-saffron-soft">{byline.join(' · ')}</p>
          <FitTitle text={artist.name} maxRem={10} className="mt-2" />
          {appearances.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="mono text-muted">As seen on</span>
              {appearances.map((a) => (
                <Link
                  key={`${a.season.show.slug}-${a.season.number}-${a.role}`}
                  to={`/shows/${a.season.show.slug}#season-${a.season.number}`}
                  className={`mono border-2 border-ink px-2 py-1 shadow-hard-sm transition hover:-translate-y-0.5 ${
                    a.role === 'WINNER' ? 'bg-saffron' : a.role === 'RUNNER_UP' ? 'bg-neon' : 'bg-surface'
                  }`}
                >
                  {a.role === 'WINNER' && '🏆 '}
                  {a.season.show.name} S{a.season.number} · {a.role === 'CONTESTANT' && a.placement ? a.placement : SHOW_ROLE_LABEL[a.role]}
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {artist.genres.map((g) => (
              <Link key={g.slug} to={`/artists?genre=${g.slug}`} className="chip">
                {g.name}
              </Link>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <FollowButton slug={artist.slug} isFollowing={artist.isFollowing} />
            {artist.instagramUrl && <InstagramLink url={artist.instagramUrl} />}
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="btn-ghost !px-3 !py-2">
                {l.label} <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </div>
      </section>

      <div className="mb-14 flex flex-wrap gap-3">
        <Stat value={artist.stats.followers} label="Followers" />
        <Stat value={artist.stats.songs} label="Songs" />
        <Stat value={artist.stats.likes} label="Likes" />
      </div>

      <div className="grid gap-12 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <section className="mb-16">
            <SectionHeader kicker="Most liked" title="The hits" />
            {topSongs.length ? (
              <TrackList>
                {topSongs.map((s, i) => (
                  <SongRow key={s.id} song={s} index={i + 1} />
                ))}
              </TrackList>
            ) : (
              <Empty title="No songs yet" />
            )}
          </section>
        </div>

        {artist.bio && (
          <aside className="min-w-0">
            <div className="tape relative rotate-1 border border-ink/10 bg-surface p-6 shadow-hard">
              <p className="mono text-saffron-soft">The story</p>
              <h2 className="display mt-1 text-3xl">About {artist.name}</h2>
              <p className="mt-3 leading-relaxed whitespace-pre-line">{artist.bio}</p>
            </div>
          </aside>
        )}
      </div>

      {artist.albums.length > 0 && (
        <Shelf kicker="Albums, EPs & mixtapes" title="Discography">
          {artist.albums.map((a) => <AlbumTile key={a.id} album={a} />)}
        </Shelf>
      )}

      {produced.length > 0 && (
        <Shelf kicker={`Beats by ${at(artist)}`} title="Produced">
          {produced.map((s) => <SongTile key={s.id} song={s} />)}
        </Shelf>
      )}

      {featuredOn.length > 0 && (
        <Shelf kicker="Guest verses" title="Featured on">
          {featuredOn.map((s) => <SongTile key={s.id} song={s} />)}
        </Shelf>
      )}

      <Catalog slug={artist.slug} />

      <MissingHere
        onClick={() => openSuggest({ type: 'CORRECTION', message: `About ${artist.name}: ` })}
        text={`Something wrong or missing on ${artist.name}'s page? A song, a feature, the bio?`}
      />

      {related.length > 0 && (
        <Shelf kicker="Same sound, same city, shared tracks" title="Also on the wall">
          {related.map((a) => <ArtistTile key={a.id} artist={a} />)}
        </Shelf>
      )}
    </div>
  );
}
