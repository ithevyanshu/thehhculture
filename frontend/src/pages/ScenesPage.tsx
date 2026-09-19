import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useRegions } from '../lib/queries';
import { Artwork } from '../components/Artwork';
import { SPOT_COLORS, Spinner, spotText } from '../components/ui';
import type { ArtistCard, Paged } from '../lib/types';

/** Every artist (the API pages at 100), so no one is missing from their city. */
async function fetchAllArtists() {
  const all: ArtistCard[] = [];
  for (let page = 1; ; page++) {
    const res = await api<Paged<ArtistCard>>('/artists', { query: { sort: 'popular', limit: 100, page } });
    all.push(...res.items);
    if (page >= res.meta.totalPages) return all;
  }
}

/** City-by-city map of the scene: one poster block per region with its artists. */
export function ScenesPage() {
  const regions = useRegions();
  const artists = useQuery({ queryKey: ['artists', 'all'], queryFn: fetchAllArtists, staleTime: 5 * 60_000 });

  if (regions.isLoading || artists.isLoading) return <Spinner />;

  const byRegion = new Map<string, ArtistCard[]>();
  for (const a of artists.data ?? []) {
    if (!a.region) continue;
    byRegion.set(a.region.slug, [...(byRegion.get(a.region.slug) ?? []), a]);
  }
  // Biggest scenes first.
  const list = (regions.data?.items ?? [])
    .filter((r) => byRegion.has(r.slug))
    .sort((a, b) => byRegion.get(b.slug)!.length - byRegion.get(a.slug)!.length || a.name.localeCompare(b.name));

  return (
    <div>
      <p className="mono text-saffron-soft">The map</p>
      <h1 className="display text-7xl md:text-9xl">Scenes</h1>
      <p className="mt-3 mb-12 max-w-xl text-lg">
        Every city has its own sound. From Mumbai's gullies to Delhi's boom bap and Kerala's new wave, here's who's repping where.
      </p>

      {/* Masonry columns: each card is only as tall as its artist list. */}
      <div className="gap-8 md:columns-2 xl:columns-3">
        {list.map((r, i) => {
          const bg = SPOT_COLORS[i % SPOT_COLORS.length];
          const members = byRegion.get(r.slug) ?? [];
          return (
            <section key={r.id} className="mb-8 break-inside-avoid border-2 border-ink bg-surface shadow-hard">
              <Link
                to={`/artists?region=${r.slug}`}
                className="flex items-end justify-between gap-4 border-b-2 border-ink p-5 transition hover:brightness-95"
                style={{ background: bg, color: spotText(bg) }}
              >
                <div className="min-w-0">
                  <p className="mono opacity-80">{r.state}</p>
                  <h2 className="display text-5xl leading-none break-words 2xl:text-6xl">{r.name}</h2>
                </div>
                <span className="display shrink-0 text-5xl opacity-90">{String(members.length).padStart(2, '0')}</span>
              </Link>
              <ul className="divide-y divide-dashed divide-ink/25">
                {members.map((a) => (
                  <li key={a.id}>
                    <Link to={`/artists/${a.slug}`} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-neon/50">
                      <div className="size-10 shrink-0 border-2 border-ink">
                        <Artwork src={a.imageUrl} name={a.name} seed={a.slug} />
                      </div>
                      <span className="font-bold uppercase">{a.name}</span>
                      <span className="mono ml-auto truncate text-muted">{a.genres.map((g) => g.name).join(' · ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
