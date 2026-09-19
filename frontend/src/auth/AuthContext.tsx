import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSession, refreshSession, setAccessToken, type Session } from '../lib/api';
import type { User } from '../lib/types';

interface AuthState {
  user: User | null;
  /** True until the initial session restore has finished. */
  loading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  register: (input: { email: string; username: string; password: string; displayName?: string }) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
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

  const register = useCallback(
    async (input: { email: string; username: string; password: string; displayName?: string }) =>
      startSession(await api<Session>('/auth/register', { method: 'POST', body: input })),
    [startSession],
  );

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    setAccessToken(null);
    setUserState(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, setUser: setUserState }),
    [user, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
