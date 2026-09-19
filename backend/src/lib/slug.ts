import { randomBytes } from 'crypto';

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/δ/g, 'a') // stylised names like "MC STΔN"
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Build a slug that is unique according to `exists`, appending a short suffix on collision. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || randomBytes(3).toString('hex');
  if (!(await exists(root))) return root;
  for (let i = 2; i < 50; i++) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${randomBytes(3).toString('hex')}`;
}
