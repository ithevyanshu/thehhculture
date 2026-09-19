import { ExternalLink, Music2, MonitorPlay } from 'lucide-react';
import { useState } from 'react';
import { spotifySearchUrl, youtubeSearchUrl } from '../lib/format';
import type { SongCard } from '../lib/types';

/**
 * Plays via official Spotify / YouTube embeds when IDs are set (admin panel),
 * otherwise falls back to search links - no audio is hosted by DHH/CULTURE.
 */
export function EmbedPlayer({ song }: { song: SongCard }) {
  const hasSpotify = !!song.spotifyTrackId;
  const hasYoutube = !!song.youtubeVideoId;
  const [tab, setTab] = useState<'spotify' | 'youtube'>(hasSpotify ? 'spotify' : 'youtube');
  const query = `${song.artist.name} ${song.title}`;

  if (!hasSpotify && !hasYoutube) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 border-2 border-dashed border-ink bg-surface p-5">
        <p className="mono">press play elsewhere →</p>
        <div className="flex flex-wrap gap-2">
          <a href={spotifySearchUrl(query)} target="_blank" rel="noreferrer" className="btn-ghost">
            <Music2 size={16} /> Spotify <ExternalLink size={14} />
          </a>
          <a href={youtubeSearchUrl(query)} target="_blank" rel="noreferrer" className="btn-ghost">
            <MonitorPlay size={16} /> YouTube <ExternalLink size={14} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden border-2 border-ink bg-surface shadow-hard">
      {hasSpotify && hasYoutube && (
        <div className="flex gap-1 border-b-2 border-ink p-1.5">
          {(['spotify', 'youtube'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`chip ${tab === t ? 'chip-active' : ''} capitalize`}>
              {t}
            </button>
          ))}
        </div>
      )}
      {tab === 'spotify' && hasSpotify ? (
        <iframe
          title={`${song.title} on Spotify`}
          src={`https://open.spotify.com/embed/track/${song.spotifyTrackId}?theme=0`}
          className="block h-[152px] w-full"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
        />
      ) : (
        <div className="aspect-video">
          <iframe
            title={`${song.title} on YouTube`}
            src={`https://www.youtube-nocookie.com/embed/${song.youtubeVideoId}`}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
          />
        </div>
      )}
    </div>
  );
}
