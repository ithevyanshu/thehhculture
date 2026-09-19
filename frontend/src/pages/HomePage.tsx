import { Link } from 'react-router-dom';
import { Pin, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useHome } from '../lib/queries';
import { toQuery } from '../lib/api';
import { issueDate, issueNumber } from '../lib/format';
import { ArtistTile, PlaylistTile, SongRow, SongTile, TrackList } from '../components/Cards';
import { ShowTile } from '../components/ShowTile';
import { CoverCarousel } from '../components/CoverCarousel';
import { ErrorState, SPOT_COLORS, SectionHeader, SeeAll, Shelf, Spinner, spotText } from '../components/ui';
import type { HomeSection } from '../lib/types';

type Section<K extends HomeSection['kind']> = Extract<HomeSection, { kind: K }>;

function seeAllLink(section: HomeSection) {
  if (!section.seeAll) return undefined;
  return `/${section.seeAll.type}${toQuery(section.seeAll.params)}`;
}

function ChartBlock({ section, kicker }: { section: Section<'chart'>; kicker: string }) {
  return (
    <section>
      <SectionHeader
        kicker={section.subtitle ?? kicker}
        title={section.title}
        action={section.seeAll && <SeeAll to={seeAllLink(section)!} />}
      />
      <TrackList>
        {section.items.map((s, i) => (
          <div key={s.id} className="relative">
            {s.pinned && (
              <Pin size={12} className="absolute top-1.5 left-1.5 z-10 -rotate-45 text-saffron" aria-label="Pinned by editors" />
            )}
            <SongRow song={s} index={i + 1} showAlbum={false} />
          </div>
        ))}
      </TrackList>
    </section>
  );
}

function ScenesBlock({ section, kicker }: { section: Section<'scenes'>; kicker: string }) {
  return (
    <section>
      <SectionHeader kicker={section.subtitle ?? kicker} title={section.title} action={<SeeAll to="/scenes" />} />
      <div className="grid grid-cols-2 gap-3">
        {section.items.map((r, i) => {
          const bg = SPOT_COLORS[i % SPOT_COLORS.length];
          return (
            <Link
              key={r.id}
              to={`/artists?region=${r.slug}`}
              className="group relative flex h-28 flex-col justify-between border-2 border-ink p-3 shadow-hard-sm transition hover:-translate-y-0.5 hover:shadow-hard"
              style={{ background: bg, color: spotText(bg) }}
            >
              <span className="mono opacity-80">{r.state}</span>
              <span className="display text-3xl leading-none">{r.name}</span>
              <span className="mono absolute top-3 right-3">{r._count?.artists}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SoundsBlock({ section, kicker }: { section: Section<'genres'>; kicker: string }) {
  const max = Math.max(1, ...section.items.map((g) => g._count?.songs ?? 0));
  return (
    <section className="mb-16">
      <SectionHeader kicker={section.subtitle ?? kicker} title={section.title} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-5 py-2">
        {section.items.map((g, i) => {
          const weight = (g._count?.songs ?? 0) / max;
          const bg = SPOT_COLORS[i % SPOT_COLORS.length];
          return (
            <Link
              key={g.id}
              to={`/songs?genre=${g.slug}`}
              className={`display border-2 border-ink px-3 py-1 shadow-hard-sm transition hover:rotate-0 hover:shadow-hard ${
                i % 2 ? 'rotate-2' : '-rotate-2'
              }`}
              style={{ background: bg, color: spotText(bg), fontSize: `${1.25 + weight * 1.5}rem` }}
            >
              {g.name}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function SectionView({ section, kicker }: { section: HomeSection; kicker: string }) {
  const common = { title: section.title, subtitle: section.subtitle, kicker, seeAllTo: seeAllLink(section) };
  switch (section.kind) {
    case 'songs':
      return <Shelf {...common}>{section.items.map((s) => <SongTile key={s.id} song={s} />)}</Shelf>;
    case 'artists':
      return <Shelf {...common}>{section.items.map((a) => <ArtistTile key={a.id} artist={a} />)}</Shelf>;
    case 'shows':
      return (
        <Shelf {...common} seeAllTo="/shows" cols="grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {section.items.map((s) => (
            <ShowTile key={s.id} show={s} />
          ))}
        </Shelf>
      );
    case 'artist-ranking':
      return (
        <Shelf {...common} cols="grid-cols-2 sm:grid-cols-3 md:grid-cols-5">
          {section.items.map((a, i) => (
            <ArtistTile key={a.id} artist={a} rank={i + 1} />
          ))}
        </Shelf>
      );
    case 'playlists':
      return (
        <Shelf {...common} seeAllTo="/library">
          {section.items.map((p) => <PlaylistTile key={p.id} playlist={p} />)}
        </Shelf>
      );
    case 'recent':
      return (
        <Shelf {...common} cols="grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
          {section.items.map((item) =>
            item.kind === 'artist' ? (
              <ArtistTile key={`a-${item.artist.id}`} artist={item.artist} showFollow={false} />
            ) : (
              <SongTile key={`s-${item.song.id}`} song={item.song} />
            ),
          )}
        </Shelf>
      );
    case 'genres':
      return <SoundsBlock section={section} kicker={kicker} />;
    case 'chart':
      return (
        <div className="mb-16">
          <ChartBlock section={section} kicker={kicker} />
        </div>
      );
    case 'scenes':
      return (
        <div className="mb-16">
          <ScenesBlock section={section} kicker={kicker} />
        </div>
      );
  }
}

/** Render sections in server order; a Chart directly followed by Scenes (or vice versa) shares a row. */
function Sections({ sections }: { sections: HomeSection[] }) {
  const out: React.ReactNode[] = [];
  for (let i = 0; i < sections.length; i++) {
    const a = sections[i];
    const b = sections[i + 1];
    const kicker = `§ ${String(i + 1).padStart(2, '0')}`;
    const isPair = b && ((a.kind === 'chart' && b.kind === 'scenes') || (a.kind === 'scenes' && b.kind === 'chart'));
    if (isPair) {
      const chart = (a.kind === 'chart' ? a : b) as Section<'chart'>;
      const scenes = (a.kind === 'scenes' ? a : b) as Section<'scenes'>;
      out.push(
        <div key={`${a.id}+${b.id}`} className="mb-16 grid gap-12 lg:grid-cols-[7fr_5fr]">
          <ChartBlock section={chart} kicker={kicker} />
          <ScenesBlock section={scenes} kicker={`§ ${String(i + 2).padStart(2, '0')}`} />
        </div>,
      );
      i++;
      continue;
    }
    out.push(<SectionView key={a.id} section={a} kicker={kicker} />);
  }
  return <>{out}</>;
}

export function HomePage() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useHome();

  if (isLoading) return <Spinner label="Printing this week's issue" />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  return (
    <div>
      {/* Masthead */}
      <div className="mono mb-10 flex flex-wrap items-center justify-between gap-2 border-y-2 border-ink py-2">
        <span>Issue #{issueNumber()}</span>
        <span className="hidden sm:inline">The front page of Indian hip hop</span>
        <span>{data.personalized ? `For ${data.greetingName}` : issueDate()}</span>
      </div>

      {user && data.onboarded === false && (
        <Link
          to="/onboarding"
          className="mb-10 flex items-center gap-4 border-2 border-ink bg-neon p-4 shadow-hard transition hover:-translate-y-0.5"
        >
          <Sparkles className="shrink-0" />
          <div>
            <p className="display text-2xl">Tune your feed</p>
            <p className="text-sm">Pick your favourite sounds, cities and artists so every issue is made for you.</p>
          </div>
        </Link>
      )}

      <CoverCarousel heroes={data.heroes ?? (data.hero ? [data.hero] : [])} interval={data.heroInterval} />

      {!user && (
        <div className="mb-16 flex flex-col items-start justify-between gap-4 border-2 border-ink bg-ink p-6 text-paper shadow-hard-saffron md:flex-row md:items-center">
          <div>
            <p className="display text-4xl">
              Make it <span className="text-saffron">yours</span>
            </p>
            <p className="mt-1 text-sm text-paper/75">
              Follow artists, like songs, build playlists, and get your own edition of the front page.
            </p>
          </div>
          <Link to="/register" className="btn shrink-0 border-paper bg-saffron text-ink">
            Get your copy (it's free)
          </Link>
        </div>
      )}

      <Sections sections={data.sections} />
    </div>
  );
}
