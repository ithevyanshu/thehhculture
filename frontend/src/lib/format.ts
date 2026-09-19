export function year(date: string | null | undefined) {
  return date ? new Date(date).getUTCFullYear() : null;
}

export function duration(sec: number | null | undefined) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function compact(n: number) {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${compact(n)} ${n === 1 ? word : pluralWord}`;
}

export function spotifySearchUrl(q: string) {
  return `https://open.spotify.com/search/${encodeURIComponent(q)}`;
}

export function youtubeSearchUrl(q: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/** Deterministic two-tone print swatch for artwork placeholders. */
const SWATCHES = [
  { bg: '#16130f', fg: '#f2ecdf' },
  { bg: '#f05a0a', fg: '#16130f' },
  { bg: '#d62839', fg: '#f2ecdf' },
  { bg: '#d9f24a', fg: '#16130f' },
  { bg: '#2b4c7e', fg: '#f2ecdf' },
  { bg: '#e8e0cf', fg: '#16130f' },
];

export function swatchFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

/** Current zine "issue": ISO-ish week number of the year. */
export function issueNumber(d = new Date()) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start) / 86_400_000 + new Date(start).getUTCDay() + 1) / 7);
}

export function issueDate(d = new Date()) {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

export function initials(name: string) {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** "@handle" for display; falls back to the URL name for artists without one yet. */
export const at = (a: { handle?: string | null; slug: string }) => `@${a.handle || a.slug}`;

/** Instagram rules: a-z, 0-9, "." and "_", max 30. "Seedhe Maut" -> seedhe_maut. */
export function toHandle(input: string) {
  return input
    .trim()
    .replace(/^@/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/δ/g, 'a')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/[._]{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 30);
}
/** Live-typing version of toHandle: keeps trailing "_" / "." so users can keep typing. */
export const typingHandle = (s: string) =>
  s.replace(/^@/, '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9._]/g, '').slice(0, 30);