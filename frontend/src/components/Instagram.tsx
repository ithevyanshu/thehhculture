/** Instagram glyph (lucide v1 dropped brand icons, so it's drawn inline). */
export function InstagramGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function instagramHandle(url: string) {
  return url.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1] ?? null;
}

/** "@handle" button (artist page) or compact square icon (cards). */
export function InstagramLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const handle = instagramHandle(url);
  const label = handle ? `@${handle} on Instagram` : 'Instagram';
  if (compact) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        aria-label={label}
        title={label}
        className="grid size-[34px] shrink-0 place-items-center border-2 border-ink bg-surface transition hover:bg-saffron"
      >
        <InstagramGlyph size={15} />
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="btn-ghost !px-3 !py-2 !normal-case" aria-label={label}>
      <InstagramGlyph size={15} /> {handle ? `@${handle}` : 'Instagram'}
    </a>
  );
}
