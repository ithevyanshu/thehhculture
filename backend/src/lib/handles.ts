/**
 * Artist @handles follow Instagram's rules (a-z, 0-9, "." and "_", max 30) so that the
 * handle can simply be the artist's Instagram username. Without Instagram, it's the
 * stage name in that format ("Seedhe Maut" -> seedhe_maut, "KR$NA" -> krsna).
 */
import { prisma } from './prisma';

export const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeHandle(input: string): string {
  return input
    .trim()
    .replace(/^@/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/δ/g, 'a')
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9._]/g, '')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 30);
}

/** Handle derived from the stage name. */
export const stageHandle = (name: string) => normalizeHandle(name) || 'artist';

/** Instagram username from a profile URL, already in handle format. */
export function instagramUsername(url: string | null | undefined): string | null {
  const m = url?.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  return m ? m[1].toLowerCase() : null;
}

/** Preferred automatic handle: Instagram username, else stage_name. */
export const autoHandle = (a: { name: string; instagramUrl?: string | null }) => instagramUsername(a.instagramUrl) ?? stageHandle(a.name);

/** Makes `base` unique among artists (suffixing _2, _3...), ignoring `selfId`. */
export async function uniqueHandle(base: string, selfId?: string): Promise<string> {
  const root = normalizeHandle(base) || 'artist';
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? root : `${root.slice(0, 30 - String(i).length - 1)}_${i}`;
    const taken = await prisma.artist.findUnique({ where: { handle: candidate }, select: { id: true } });
    if (!taken || taken.id === selfId) return candidate;
  }
  return `${root.slice(0, 22)}_${Date.now().toString(36).slice(-7)}`;
}

/**
 * Handle after an Instagram change: an automatic handle (stage_name form) follows the
 * new Instagram username; a hand-edited handle is left alone.
 */
export async function handleAfterInstagramChange(
  artist: { id: string; name: string; handle: string | null },
  newInstagramUrl: string | null,
): Promise<string | undefined> {
  const ig = instagramUsername(newInstagramUrl);
  const wasAutomatic = !artist.handle || artist.handle.replace(/_\d+$/, '') === stageHandle(artist.name);
  if (!ig || !wasAutomatic || artist.handle === ig) return undefined;
  return uniqueHandle(ig, artist.id);
}
