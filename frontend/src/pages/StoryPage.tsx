import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink, Newspaper } from 'lucide-react';
import { api } from '../lib/api';
import { useIssueNumber } from '../lib/queries';
import { useAuth } from '../auth/AuthContext';
import { canShare } from '../lib/permissions';
import { Artwork } from '../components/Artwork';
import { ArtistTile } from '../components/Cards';
import { SmartLink } from '../components/SmartLink';
import { ShareButton } from '../components/ShareImage';
import { ErrorState, FitTitle, SectionHeader, Spinner } from '../components/ui';
import type { ArtistCard } from '../lib/types';

interface Story {
  slug: string;
  kicker: string | null;
  headline: string;
  /** The carousel teaser. */
  body: string | null;
  /** The long version, when one was written. */
  article: string | null;
  /** Admin opt-in: visitors get the share button too. */
  shareable?: boolean;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  artists: ArtistCard[];
}

export function StoryPage() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const issue = useIssueNumber();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['story', slug],
    queryFn: () => api<{ story: Story }>(`/site/stories/${slug}`),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;

  const { story } = data;
  // The long piece when there is one, otherwise the teaser is the whole story.
  const text = story.article || story.body;

  return (
    <article className="mx-auto max-w-4xl">
      <Link to="/" className="mono mb-6 inline-flex items-center gap-1 text-muted hover:underline">
        <ArrowLeft size={13} /> Front page
      </Link>

      <p className="mono flex flex-wrap items-center gap-2 text-saffron-soft">
        <span className="sticker !bg-red !text-paper">{story.kicker ?? 'News'}</span>
        <Newspaper size={14} /> News · Issue #{issue}
      </p>
      <FitTitle text={story.headline} maxRem={7} className="mt-3" />

      {story.imageUrl && (
        <div className="tape relative mt-8 border border-ink/10 bg-surface p-3 pb-6 shadow-hard">
          <Artwork src={story.imageUrl} name={story.headline} live />
        </div>
      )}

      {text && <div className="mt-8 max-w-2xl text-lg leading-relaxed whitespace-pre-line">{text}</div>}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        {story.linkUrl && (
          <SmartLink href={story.linkUrl} className="btn-primary">
            {story.linkLabel ?? 'Read more'} <ExternalLink size={14} />
          </SmartLink>
        )}
        {(canShare(user) || story.shareable) && (
          <ShareButton
            content={{
              kicker: story.kicker ?? 'News',
              title: story.headline,
              subtitle: story.artists.map((a) => a.name).join(' · ') || null,
              imageUrl: story.imageUrl,
              url: `https://dhhculture.in/story/${story.slug}`,
            }}
          />
        )}
      </div>

      {story.artists.length > 0 && (
        <section className="mt-14">
          <SectionHeader title="In this story" />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {story.artists.map((a) => (
              <ArtistTile key={a.id} artist={a} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
