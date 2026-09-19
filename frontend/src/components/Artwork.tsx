import { useState } from 'react';
import { initials, swatchFor } from '../lib/format';

interface Props {
  src?: string | null;
  name: string;
  seed?: string;
  round?: boolean;
  /** Full colour instead of the zine's halftone treatment. */
  live?: boolean;
  className?: string;
  /** Hover tooltip, e.g. photo credit. */
  title?: string;
}

/**
 * Photos get a halftone print treatment (colour on hover). Items without artwork
 * get a two-tone poster block with initials, so the page never has empty holes.
 */
export function Artwork({ src, name, seed, round, live, className = '', title }: Props) {
  const [failed, setFailed] = useState(false);
  const shape = round ? 'rounded-full' : '';

  if (src && !failed) {
    return (
      <div className={`halftone aspect-square w-full overflow-hidden bg-surface-2 ${live ? 'halftone-live' : ''} ${shape} ${className}`}>
        <img
          src={src}
          alt={name}
          title={title}
          loading="lazy"
          onError={() => setFailed(true)}
          // Bias the crop upward so portrait photos keep faces in frame.
          className="size-full object-cover object-[center_25%]"
        />
      </div>
    );
  }

  const { bg, fg } = swatchFor(seed ?? name);
  return (
    <div
      role="img"
      aria-label={name}
      style={{ background: bg, color: fg }}
      className={`halftone relative grid aspect-square w-full place-items-center overflow-hidden [container-type:inline-size] ${shape} ${className}`}
    >
      <span className="w-full px-2 text-center font-display text-[36cqw] leading-none select-none">{initials(name)}</span>
    </div>
  );
}
