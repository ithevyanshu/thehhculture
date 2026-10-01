import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSession, refreshSession, setAccessToken, type Session } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  /** True until the initial session restore has finished. */
  loading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  /** Invite-only: this asks to join and never signs anyone in. */
  requestInvite: (input: InviteRequest) => Promise<{ status: string; message: string }>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
}

export interface InviteRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  note?: string;
  instagramUrl?: string;
  artistIds?: string[];
  genreSlugs?: string[];
  regionSlug?: string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    onSession((u) => setUserState(u));
    refreshSession()
      .then((session) => setUserState(session?.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  const startSession = useCallback(
    (session: Session) => {
      setAccessToken(session.accessToken);
      setUserState(session.user);
      queryClient.invalidateQueries();
      return session.user;
    },
    [queryClient],
  );

  const login = useCallback(
    async (identifier: string, password: string) =>
      startSession(await api<Session>('/auth/login', { method: 'POST', body: { identifier, password } })),
    [startSession],
  );

  const requestInvite = useCallback(
    (input: InviteRequest) => api<{ status: string; message: string }>('/auth/register', { method: 'POST', body: input }),
    [],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUserState(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, loading, login, requestInvite, logout, setUser: setUserState }),
    [user, loading, login, requestInvite, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
