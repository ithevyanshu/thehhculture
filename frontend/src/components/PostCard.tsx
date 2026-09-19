import { Link } from 'react-router-dom';
import { ArrowUpRight, Mic } from 'lucide-react';
import { Artwork } from './Artwork';
import { SmartLink } from './SmartLink';
import type { ArtistPost, ArtistRef } from '../lib/types';

const when = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days < 1) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** An artist's own update from the Studio. `artist` is omitted on their own page. */
export function PostCard({ post, artist }: { post: ArtistPost; artist?: ArtistRef }) {
  return (
    <article className="flex h-full min-w-0 flex-col border-2 border-ink bg-surface p-4 shadow-hard-sm">
      <header className="mb-3 flex items-center gap-2">
        {artist ? (
          <Link to={`/artists/${artist.slug}`} className="flex min-w-0 items-center gap-2 hover:underline">
            <div className="size-8 shrink-0 border border-ink">
              <Artwork src={artist.imageUrl ?? null} name={artist.name} seed={artist.slug} live />
            </div>
            <b className="truncate uppercase">{artist.name}</b>
          </Link>
        ) : (
          <span className="mono flex items-center gap-1 text-saffron-soft">
            <Mic size={12} /> From the artist
          </span>
        )}
        <span className="mono ml-auto shrink-0 text-muted">{when(post.createdAt)}</span>
      </header>
      <p className="flex-1 break-words whitespace-pre-line">{post.text}</p>
      {post.linkUrl && (
        <SmartLink href={post.linkUrl} className="mono mt-3 inline-flex items-center gap-1 self-start text-saffron-soft hover:underline">
          Open link <ArrowUpRight size={12} />
        </SmartLink>
      )}
    </article>
  );
}
