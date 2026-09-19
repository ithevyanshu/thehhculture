import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BadgeCheck, ExternalLink, Mic } from 'lucide-react';
import { useArtist, useArtistSongs } from '../lib/queries';
import { at, compact } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { AlbumTile, ArtistTile, SongRow, SongTile, TrackList } from '../components/Cards';
import { FollowButton } from '../components/Buttons';
import { MissingHere, useSuggest } from '../components/Suggest';
import { InstagramLink } from '../components/Instagram';
import { PostCard } from '../components/PostCard';
import { SHOW_ROLE_LABEL, type ShowAppearance, type ShowRole } from '../lib/types';
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

const ROLE_ORDER: ShowRole[] = ['WINNER', 'RUNNER_UP', 'FINALIST', 'FEATURED', 'CONTESTANT', 'JUDGE', 'GUEST_JUDGE', 'HOST'];

/** One badge per show + role ("MTV Hustle S1 · S4 | Judge"), best result first. */
function groupAppearances(appearances: ShowAppearance[]) {
  const groups = new Map<string, { key: string; show: ShowAppearance['season']['show']; role: ShowRole; label: string; seasons: number[] }>();
  for (const a of appearances) {
    // Contestants keep their placement ("Top 10"); 64 Bars-style features are just "Featured".
    const label = a.role === 'CONTESTANT' && a.placement ? a.placement : a.role === 'FEATURED' ? 'Featured' : SHOW_ROLE_LABEL[a.role];
    const key = `${a.season.show.slug}|${a.role}|${label}`;
    const g = groups.get(key) ?? { key, show: a.season.show, role: a.role, label, seasons: [] };
    g.seasons.push(a.season.number);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, seasons: g.seasons.sort((x, y) => x - y) }))
    .sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role));
}

export function ArtistPage() {
  const openSuggest = useSuggest();
  const { slug = '' } = useParams();
  const { data, isLoading, error, refetch } = useArtist(slug);

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  const { artist, topSongs, featuredOn, related, produced, appearances, posts = [] } = data;
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
              {groupAppearances(appearances).map((g) => (
                <Link
                  key={g.key}
                  to={`/shows/${g.show.slug}#season-${g.seasons[0]}`}
                  className={`mono inline-flex items-center border-2 border-ink shadow-hard-sm transition hover:-translate-y-0.5 ${
                    g.role === 'WINNER' ? 'bg-saffron' : g.role === 'RUNNER_UP' ? 'bg-neon' : 'bg-surface'
                  }`}
                >
                  <span className="px-2 py-1">
                    {g.role === 'WINNER' && '🏆 '}
                    {g.show.name} <span className="opacity-60">{g.seasons.map((n) => `S${n}`).join(' · ')}</span>
                  </span>
                  <span className="border-l-2 border-ink bg-ink px-2 py-1 text-paper">{g.label}</span>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {artist.managed && (
              <span className="mono inline-flex items-center gap-1 border-2 border-ink bg-saffron px-2.5 py-1" title="This profile is run by the artist or their team">
                <Mic size={12} /> Official
              </span>
            )}
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

      <div className="mb-16 grid gap-12 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0">
          <section>
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

      {posts.length > 0 && (
        <section className="mb-16">
          <SectionHeader kicker="Straight from the artist" title="Updates" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>
      )}

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
