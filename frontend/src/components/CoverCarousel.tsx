import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Pause, Play } from 'lucide-react';
import { issueNumber } from '../lib/format';
import { Artwork } from './Artwork';
import { FollowButton } from './Buttons';
import { FitTitle } from './ui';
import type { Hero } from '../lib/types';

const HERO_STICKER = { following: 'New from your artists', featured: 'Cover story', editorial: "Editor's pick" } as const;

function CoverSlide({ hero, tilt }: { hero: Hero; tilt: 'left' | 'right' }) {
  const { artist, song, reason } = hero;
  const blurb = hero.blurb ?? artist.bio;
  return (
    <div className="grid items-center gap-10 md:grid-cols-[5fr_7fr]">
      <div className="relative mx-auto w-full max-w-sm md:max-w-none">
        <div className={`tape relative border border-ink/10 bg-surface p-3 pb-10 shadow-hard ${tilt === 'left' ? '-rotate-2' : 'rotate-2'}`}>
          <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} />
          <p className="marker absolute right-4 bottom-2 text-lg text-ink/70">{artist.region?.name ?? 'India'}</p>
        </div>
        <span className="sticker absolute -top-3 -right-2 z-10 rotate-6 !text-base">{hero.kicker ?? HERO_STICKER[reason]}</span>
      </div>

      <div className="min-w-0">
        <p className="mono text-saffron-soft">Cover story · Issue #{issueNumber()}</p>
        <FitTitle text={artist.name} className="mt-2" />
        {blurb && <p className="mt-5 line-clamp-6 max-w-xl text-lg leading-relaxed">{blurb}</p>}
        {song && (
          <Link to={`/songs/${song.slug}`} className="group mt-6 inline-flex items-center gap-3">
            <span className="marker text-xl text-saffron-soft">{reason === 'editorial' ? 'press play →' : 'latest drop →'}</span>
            <span className="highlight text-xl font-bold uppercase">{song.title}</span>
          </Link>
        )}
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link to={`/artists/${artist.slug}`} className="btn-primary">
            Read the profile <ArrowRight size={14} />
          </Link>
          <FollowButton slug={artist.slug} isFollowing={artist.isFollowing} />
        </div>
      </div>
    </div>
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
        <CoverSlide hero={heroes[0]} tilt="left" />
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
      className="mb-16 touch-pan-y"
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
              key={`${hero.artist.id}-${i}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${count}: ${hero.artist.name}`}
              aria-hidden={i !== current}
              inert={i !== current}
              className={`[grid-area:1/1] transition duration-500 ease-out ${
                offset === 0 ? 'opacity-100' : `pointer-events-none opacity-0 ${offset < 0 ? '-translate-x-10' : 'translate-x-10'}`
              }`}
            >
              <CoverSlide hero={hero} tilt={i % 2 ? 'right' : 'left'} />
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex items-stretch gap-2">
        <button type="button" className="btn-ghost !px-3" aria-label="Previous cover story" onClick={() => go(current - 1)}>
          <ArrowLeft size={16} />
        </button>

        <div className="flex min-w-0 flex-1 gap-2">
          {heroes.map((hero, i) => (
            <button
              key={`${hero.artist.id}-${i}`}
              type="button"
              onClick={() => go(i)}
              aria-label={`Show cover story ${i + 1}: ${hero.artist.name}`}
              aria-current={i === current}
              className={`relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden border-2 border-ink px-2 py-1.5 text-left transition ${
                i === current ? 'bg-ink text-paper' : 'bg-surface hover:bg-neon'
              }`}
            >
              <span className="mono shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <span className="hidden truncate text-sm font-bold uppercase md:inline">{hero.artist.name}</span>
              {i === current && (
                <span
                  key={current}
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-1 origin-left scale-x-0 bg-saffron"
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
    </section>
  );
}
