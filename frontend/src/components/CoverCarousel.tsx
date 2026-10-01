import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, Newspaper, Pause, Play } from 'lucide-react';
import { useIssueNumber } from '../lib/queries';
import { Artwork } from './Artwork';
import { FollowButton } from './Buttons';
import { FitTitle } from './ui';
import { SmartLink } from './SmartLink';
import { ShareButton } from './ShareImage';
import { useAuth } from '../auth/AuthContext';
import { canShare } from '../lib/permissions';
import type { ArtistHero, Hero, NewsHero } from '../lib/types';

const HERO_STICKER = { following: 'New from your artists', featured: 'Cover story', editorial: "Editor's pick" } as const;

/** Where the slide sits in the run, printed in the polaroid's bottom margin. */
interface Counter {
  index: number;
  total: number;
}

/** Red flag + the issue line, the way a masthead sets a section label. */
function Kicker({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="mono flex flex-wrap items-center gap-x-3 gap-y-1 text-saffron-soft">
      <span className="bg-red px-2 py-1 text-paper">{label}</span>
      {children}
    </p>
  );
}

function SlideCount({ counter }: { counter?: Counter }) {
  if (!counter) return null;
  return (
    <p className="mono absolute bottom-3.5 left-4 text-ink/50">
      {String(counter.index).padStart(2, '0')} / {String(counter.total).padStart(2, '0')}
    </p>
  );
}

function CoverSlide({ hero, tilt, counter }: { hero: ArtistHero; tilt: 'left' | 'right'; counter?: Counter }) {
  const issue = useIssueNumber();
  const { artist, song, reason } = hero;
  const blurb = hero.blurb ?? artist.bio;
  return (
    // Same three arrangements as the news slide; see the comment there.
    <div className="grid items-start gap-x-5 gap-y-6 md:gap-x-10 xs:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <div className="xs:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1">
        <Kicker label={hero.kicker ?? HERO_STICKER[reason]}>Cover story · Issue #{issue}</Kicker>
        <FitTitle text={artist.name} className="mt-3" />
      </div>

      <div className="relative mx-auto w-full max-w-sm xs:col-start-1 xs:row-start-2 xs:mx-0 xs:max-w-none lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:self-center">
        <div className={`tape relative border border-ink/10 bg-surface p-3 pb-10 shadow-hard ${tilt === 'left' ? '-rotate-2' : 'rotate-2'}`}>
          <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} />
          <SlideCount counter={counter} />
          <p className="mono absolute right-4 bottom-3.5 text-ink/70">{artist.region?.name ?? 'India'}</p>
        </div>
      </div>

      <div className="min-w-0 xs:col-start-2 xs:row-start-2 lg:col-start-2 lg:row-start-2">
        {/* Small phones get the name and the picture only; the profile is a tap away. */}
        {blurb && <p className="line-clamp-6 max-w-xl text-lg leading-relaxed max-xs:hidden">{blurb}</p>}
        {song && (
          <Link to={`/songs/${song.slug}`} className="group mt-6 inline-flex items-center gap-3">
            <span className="mono text-saffron-soft">{reason === 'editorial' ? 'press play →' : 'latest drop →'}</span>
            <span className="highlight text-xl font-bold uppercase">{song.title}</span>
          </Link>
        )}
      </div>

      {/* Buttons take the full width rather than the narrow text column. */}
      <div className="min-w-0 xs:col-span-2 xs:row-start-3 lg:col-span-1 lg:col-start-2 lg:row-start-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link to={`/artists/${artist.slug}`} className="btn-primary">
            Read the profile <ArrowRight size={14} />
          </Link>
          <FollowButton slug={artist.slug} isFollowing={artist.isFollowing} />
        </div>
      </div>
    </div>
  );
}

/** Short name for a slide: the artist, or the news headline. */
const slideTitle = (hero: Hero) => (hero.type === 'news' ? hero.headline : hero.artist.name);

function NewsSlide({ hero, tilt, counter }: { hero: NewsHero; tilt: 'left' | 'right'; counter?: Counter }) {
  const issue = useIssueNumber();
  const { user } = useAuth();
  return (
    /**
     * Three arrangements, switching at xs (450px) and lg (1024px).
     * Small phone: headline, then the picture — no body copy, so the slide is one screen.
     * Big phone and tablet: headline full width across the top, picture left, story right.
     * Desktop: picture left, the whole story (headline included) right.
     */
    <div className={`grid items-start gap-x-5 gap-y-6 md:gap-x-10 ${hero.imageUrl ? 'xs:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}`}>
      <div className={hero.imageUrl ? 'xs:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-start-1' : ''}>
        <Kicker label={hero.kicker ?? 'News'}>
          <span className="flex items-center gap-2">
            <Newspaper size={14} /> News · Issue #{issue}
          </span>
        </Kicker>
        <h2 className="display mt-3 text-5xl break-words md:text-6xl lg:text-7xl">{hero.headline}</h2>
      </div>

      {hero.imageUrl && (
        <div className="relative mx-auto w-full max-w-sm xs:col-start-1 xs:row-start-2 xs:mx-0 xs:max-w-none lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:self-center">
          <div className={`tape relative border border-ink/10 bg-surface p-3 pb-10 shadow-hard ${tilt === 'left' ? '-rotate-2' : 'rotate-2'}`}>
            <Artwork src={hero.imageUrl} name={hero.headline} live />
            <SlideCount counter={counter} />
          </div>
        </div>
      )}

      <div className={`min-w-0 ${hero.imageUrl ? 'xs:col-start-2 xs:row-start-2 lg:col-start-2 lg:row-start-2' : ''}`}>
        {/* Small phones get the headline and the picture only; the story is a tap away. */}
        {/* A dek, not the whole story: two lines on a wide screen, more where it sits beside the picture. */}
        {hero.body && <p className="line-clamp-6 max-w-2xl text-lg leading-relaxed whitespace-pre-line max-xs:hidden lg:line-clamp-2">{hero.body}</p>}
      </div>

      {/*
       * Tags and buttons share one wrapping row across the full width. Kept apart they
       * cost two rows each of their own; together they fit on a single line on a phone.
       */}
      <div
        className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 ${
          hero.imageUrl ? 'xs:col-span-2 xs:row-start-3 lg:col-span-1 lg:col-start-2 lg:row-start-3' : ''
        }`}
      >
        {hero.artists.map((a) => (
          <Link
            key={a.id}
            to={`/artists/${a.slug}`}
            className="flex items-center gap-2 border-2 border-ink bg-surface py-1 pr-3 pl-1 shadow-hard-sm transition hover:bg-neon"
          >
            <div className="size-7 border border-ink">
              <Artwork src={a.imageUrl} name={a.name} seed={a.slug} live />
            </div>
            <span className="text-sm font-bold uppercase">{a.name}</span>
          </Link>
        ))}
        {hero.slug && (
          <Link to={`/story/${hero.slug}`} className="btn-primary">
            Read the full story <ArrowRight size={14} />
          </Link>
        )}
        {hero.linkUrl && (
          <SmartLink href={hero.linkUrl} className={hero.slug ? 'btn-ghost' : 'btn-primary'}>
            {hero.linkLabel ?? 'Read more'} {hero.linkUrl.startsWith('/') ? <ArrowRight size={14} /> : <ExternalLink size={14} />}
          </SmartLink>
        )}
        {(canShare(user) || hero.shareable) && (
          <ShareButton
            content={{
              kicker: hero.kicker ?? 'News',
              title: hero.headline,
              subtitle: hero.artists.map((a) => a.name).join(' · ') || null,
              imageUrl: hero.imageUrl,
              url: hero.slug ? `https://dhhculture.in/story/${hero.slug}` : 'https://dhhculture.in',
            }}
          />
        )}
      </div>
    </div>
  );
}

function Slide({ hero, tilt, counter }: { hero: Hero; tilt: 'left' | 'right'; counter?: Counter }) {
  return hero.type === 'news' ? (
    <NewsSlide hero={hero} tilt={tilt} counter={counter} />
  ) : (
    <CoverSlide hero={hero} tilt={tilt} counter={counter} />
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Cover-story carousel. Autoplay is driven by the progress bar's CSS animation
 * (its `animationend` advances the slide), so pausing the animation pauses the timer.
 * It pauses on hover, keyboard focus, a hidden tab or the pause button, and doesn't
 * autoplay at all for reduced-motion users.
 */
export function CoverCarousel({ heroes, interval = 7 }: { heroes: Hero[]; interval?: number }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [userPaused, setUserPaused] = useState(reducedMotion);
  const [hidden, setHidden] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const count = heroes.length;
  if (!count) return null;
  if (count === 1) {
    return (
      <section className="mb-16">
        <Slide hero={heroes[0]} tilt="left" />
      </section>
    );
  }

  const current = index % count;
  const go = (i: number) => setIndex(((i % count) + count) % count);
  const paused = hovered || focused || userPaused || hidden;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') go(current - 1);
    else if (e.key === 'ArrowRight') go(current + 1);
  };

  return (
    <section
      // Hidden slides wait 40px to the side for the slide-in: clip sideways (not vertically), with
      // 16px of room so stickers and shadows stay visible, or phones get a horizontal scroll.
      className="-mx-4 mb-16 touch-pan-y overflow-x-clip px-4"
      aria-roledescription="carousel"
      aria-label="Cover stories"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Only keyboard focus pauses: a clicked arrow keeps focus after the mouse leaves.
      onFocus={(e) => setFocused(e.target.matches(':focus-visible'))}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
      onKeyDown={onKeyDown}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        if (start == null) return;
        const dx = e.changedTouches[0].clientX - start;
        if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1));
      }}
    >
      {/* Every slide sits in the same grid cell, so the block is as tall as the tallest one and never jumps. */}
      <div className="grid">
        {heroes.map((hero, i) => {
          const offset = i === current ? 0 : i < current ? -1 : 1;
          return (
            <div
              key={i}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${slideTitle(hero)}`}
              aria-hidden={i !== current}
              inert={i !== current}
              className={`[grid-area:1/1] transition duration-500 ease-out ${
                offset === 0 ? 'opacity-100' : `pointer-events-none opacity-0 ${offset < 0 ? '-translate-x-10' : 'translate-x-10'}`
              }`}
            >
              <Slide hero={hero} tilt={i % 2 ? 'right' : 'left'} counter={{ index: i + 1, total: count }} />
            </div>
          );
        })}
      </div>

      {/*
       * Contents strip: every story is named, not just numbered, so the carousel reads
       * like a front page rather than a slideshow. The red rule on the live tab doubles
       * as the autoplay timer — when it finishes filling, the next slide comes up.
       */}
      <div className="mt-10 flex flex-wrap items-stretch border-2 border-ink bg-surface">
        {/*
         * Full width below sm so the controls are pushed onto their own line. Left to
         * flex-1 they share the line with a w-full control box and get crushed to nothing.
         */}
        <div className="flex w-full min-w-0 flex-wrap sm:w-auto sm:flex-1 sm:flex-nowrap">
          {heroes.map((hero, i) => (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show cover story ${i + 1}: ${slideTitle(hero)}`}
              aria-current={i === current}
              className={`relative min-w-0 flex-1 basis-1/2 border-ink pt-4 pb-3 border-r-2 px-4 text-left transition last:border-r-0 sm:basis-0 ${
                i === current ? 'bg-surface-2' : 'hover:bg-neon/40'
              }`}
            >
              <span className={`mono block ${i === current ? 'text-saffron-soft' : 'text-dim'}`}>{String(i + 1).padStart(2, '0')}</span>
              {/*
               * Numbers alone until the desktop layout: anywhere narrower, four columns
               * or a two-up grid leave a headline shredded into a word per line.
               */}
              <span className="mt-1 line-clamp-2 hidden text-sm font-bold uppercase lg:block">{slideTitle(hero)}</span>
              {/* Faint track so the live tab always carries a red rule, bright part = time left. */}
              {i === current && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-red/25" />}
              {i === current && (
                <span
                  key={current}
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-red"
                  style={{
                    animation: `cover-progress ${interval}s linear forwards`,
                    animationPlayState: paused ? 'paused' : 'running',
                  }}
                  onAnimationEnd={() => go(current + 1)}
                />
              )}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-ink p-3 max-sm:w-full max-sm:justify-end max-sm:border-t-2 sm:border-l-2">
          <button type="button" className="btn-ghost !px-3" aria-label="Previous cover story" onClick={() => go(current - 1)}>
            <ArrowLeft size={16} />
          </button>
          <button type="button" className="btn-ghost !px-3" aria-label="Next cover story" onClick={() => go(current + 1)}>
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="btn-ghost !px-3"
            aria-label={userPaused ? 'Play slideshow' : 'Pause slideshow'}
            onClick={() => setUserPaused((p) => !p)}
          >
            {userPaused ? <Play size={16} /> : <Pause size={16} />}
          </button>
        </div>
      </div>
    </section>
  );
}
