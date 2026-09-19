import type { User } from './types';

/** Mirrors backend/src/lib/permissions.ts: one permission per admin section. */
export const PERMISSIONS = [
  { value: 'frontPage', label: 'Front page' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
  { value: 'songs', label: 'Songs' },
  { value: 'shows', label: 'Shows' },
  { value: 'taxonomy', label: 'Genres & cities' },
  { value: 'suggestions', label: 'Suggestions' },
  { value: 'users', label: 'Users (regular users only)' },
  { value: 'studio', label: 'Artist Studio (link accounts, review changes)' },
] as const;
export type Permission = (typeof PERMISSIONS)[number]['value'];

/** Admins and sub-admins get the admin panel. */
export const isStaff = (user: User | null | undefined) => user?.role === 'ADMIN' || user?.role === 'SUB_ADMIN';

/** Full admins can do everything; sub-admins only what they were granted. */
export const can = (user: User | null | undefined, permission: Permission) =>
  user?.role === 'ADMIN' || (user?.role === 'SUB_ADMIN' && user.permissions.includes(permission));
