import type { User } from './types';

/**
 * API base. Accepts "https://api.example.com", "https://api.example.com/" or the full
 * "https://api.example.com/api/v1" and normalises all of them to ".../api/v1".
 */
function apiBase(raw: string | undefined) {
  const url = (raw ?? '').trim().replace(/\/+$/, '');
  if (!url) return '/api/v1';
  return /\/api\/v1$/.test(url) ? url : `${url}/api/v1`;
}
const BASE_URL = apiBase(import.meta.env.VITE_API_URL as string | undefined);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

// Access token lives in memory only; the refresh token is an httpOnly cookie.
let accessToken: string | null = null;
let onSessionChange: ((user: User | null) => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function onSession(cb: (user: User | null) => void) {
  onSessionChange = cb;
}

export interface Session {
  user: User;
  accessToken: string;
}

let refreshInFlight: Promise<Session | null> | null = null;

/** Exchange the refresh cookie for a new access token. De-duplicates concurrent calls. */
export function refreshSession(): Promise<Session | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        setAccessToken(null);
        return null;
      }
      const session = (await res.json()) as Session;
      setAccessToken(session.accessToken);
      return session;
    } catch {
      return null;
    } finally {
      setTimeout(() => (refreshInFlight = null), 0);
    }
  })();
  return refreshInFlight;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function toQuery(params?: Query) {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
}

/** Sends a file as the raw request body (spreadsheet uploads); same auth and retry as api(). */
export async function apiUpload<T>(path: string, file: File | Blob, opts: { query?: Query } = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}${toQuery(opts.query)}`, { method: 'POST', headers, body: file, credentials: 'include' });
  if (res.status === 401 && retry && accessToken) {
    const session = await refreshSession();
    onSessionChange?.(session?.user ?? null);
    if (session) return apiUpload<T>(path, file, opts, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? `Upload failed (${res.status})`, data?.error?.details);
  return data as T;
}

/** Downloads a file the browser should save (the spreadsheet template). */
export async function apiDownload(path: string, filename: string, retry = true): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers, credentials: 'include' });
  if (res.status === 401 && retry && accessToken) {
    const session = await refreshSession();
    onSessionChange?.(session?.user ?? null);
    if (session) return apiDownload(path, filename, false);
  }
  if (!res.ok) throw new ApiError(res.status, `Could not download (${res.status})`);

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(`${BASE_URL}${path}${toQuery(opts.query)}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });

  // Access token expired: refresh once and retry.
  if (res.status === 401 && retry && accessToken && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    onSessionChange?.(session?.user ?? null);
    if (session) return api<T>(path, opts, false);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.message ?? `Request failed (${res.status})`, data?.error?.details);
  }
  return data as T;
}
