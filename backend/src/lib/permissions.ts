/**
 * Sub-admin permissions: one per admin section. Full admins have them all; sub-admins
 * have only what an admin granted (User.permissions).
 */
export const PERMISSIONS = ['artists', 'albums', 'songs', 'taxonomy', 'shows', 'frontPage', 'suggestions', 'users'] as const;
export type Permission = (typeof PERMISSIONS)[number];

type Rule = { method?: string; path: RegExp; allow: Permission[] | 'staff' };

/**
 * Which permission(s) open each /admin route; any one of them is enough. First match
 * wins. A few routes are shared because forms reach across sections (the song form
 * lists albums and quick-creates featured artists, the artist form adds cities).
 * Routes with no rule are full-admin only.
 */
const RULES: Rule[] = [
  { path: /^\/stats$/, allow: 'staff' },
  { method: 'GET', path: /^\/albums(\/|$)/, allow: ['albums', 'songs'] },
  { method: 'POST', path: /^\/artists$/, allow: ['artists', 'songs', 'shows'] },
  { method: 'POST', path: /^\/regions$/, allow: ['taxonomy', 'artists'] },
  { path: /^\/(artists|images)(\/|$)/, allow: ['artists'] },
  { path: /^\/albums(\/|$)/, allow: ['albums'] },
  { path: /^\/songs(\/|$)/, allow: ['songs'] },
  { path: /^\/(genres|regions)(\/|$)/, allow: ['taxonomy'] },
  { path: /^\/(shows|seasons)(\/|$)/, allow: ['shows'] },
  { path: /^\/site-config(\/|$)/, allow: ['frontPage'] },
  { path: /^\/suggestions(\/|$)/, allow: ['suggestions'] },
  { path: /^\/users(\/|$)/, allow: ['users'] },
];

/** Can a sub-admin with these permissions call `method path` (path relative to /admin)? */
export function subAdminCan(permissions: string[], method: string, path: string) {
  const rule = RULES.find((r) => (!r.method || r.method === method) && r.path.test(path));
  if (!rule) return false;
  return rule.allow === 'staff' || rule.allow.some((p) => permissions.includes(p));
}
