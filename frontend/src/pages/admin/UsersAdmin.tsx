import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { Artwork } from '../../components/Artwork';
import { useDialog } from '../../components/Dialog';
import { Pagination, Spinner } from '../../components/ui';
import type { Paged, Role } from '../../lib/types';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  disabled: boolean;
  onboarded: boolean;
  createdAt: string;
  _count: { follows: number; likes: number; playlists: number };
}

export function UsersAdmin() {
  const { user: me } = useAuth();
  const dialog = useDialog();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = { q, role, status, page, limit: 25 };
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => api<Paged<AdminUser>>('/admin/users', { query: params }),
    placeholderData: (prev) => prev,
  });

  const update = async (u: AdminUser, patch: { role?: 'USER' | 'ADMIN'; disabled?: boolean }) => {
    const action =
      patch.disabled === true
        ? `Disable @${u.username}? They'll be signed out and can't log in.`
        : patch.role === 'ADMIN'
          ? `Make @${u.username} an admin? They'll get full access to this panel.`
          : patch.role === 'USER'
            ? `Remove admin access from @${u.username}?`
            : null;
    if (action && !(await dialog.confirm(action, { danger: patch.disabled === true || patch.role === 'USER', confirmLabel: 'Yes, do it' }))) return;
    setBusy(u.id);
    setError(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: patch });
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="input !w-72"
          placeholder="Search name, username or email…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select className="input !w-auto" value={role} onChange={(e) => (setRole(e.target.value), setPage(1))} aria-label="Filter by role">
          <option value="">All roles</option>
          <option value="USER">Users</option>
          <option value="ADMIN">Admins</option>
        </select>
        <select className="input !w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Filter by status">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>
      {error && <p className="mb-3 border-2 border-red bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}

      {isLoading || !data ? (
        <Spinner />
      ) : (
        <>
          <div className="overflow-x-auto border-2 border-ink bg-surface shadow-hard">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="mono border-b-2 border-ink bg-paper">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => {
                  const isMe = u.id === me?.id;
                  return (
                    <tr key={u.id} className={`border-b border-dashed border-ink/25 last:border-b-0 ${u.disabled ? 'bg-surface-2 text-muted' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-3">
                          <div className="size-9 shrink-0 border border-ink">
                            <Artwork src={u.avatarUrl} name={u.displayName} seed={u.username} live />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-bold">
                              {u.displayName} {isMe && <span className="mono ml-1 bg-neon px-1">you</span>}
                            </p>
                            <p className="truncate text-xs text-muted">
                              @{u.username} · {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="mono px-3 py-2 text-muted">{new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
                      <td className="mono px-3 py-2 text-muted">
                        {u._count.follows} follows · {u._count.likes} likes · {u._count.playlists} lists
                      </td>
                      <td className="px-3 py-2">
                        <select
                          className="input !w-auto !py-1"
                          value={u.role === 'ADMIN' ? 'ADMIN' : 'USER'}
                          disabled={isMe || busy === u.id}
                          onChange={(e) => update(u, { role: e.target.value as 'USER' | 'ADMIN' })}
                          aria-label={`Role for ${u.username}`}
                        >
                          <option value="USER">User</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          className={`mono border-2 border-ink px-2 py-1 ${u.disabled ? 'bg-red text-paper' : 'bg-surface hover:bg-neon'} disabled:opacity-40`}
                          disabled={isMe || busy === u.id}
                          onClick={() => update(u, { disabled: !u.disabled })}
                          title={u.disabled ? 'Click to re-enable' : 'Click to disable'}
                        >
                          {u.disabled ? 'Disabled' : 'Active'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted">
                      No users match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} onPage={setPage} />
          <p className="mt-3 text-xs text-dim">
            Changing a role or disabling an account signs that user out everywhere. You can't change your own role or disable yourself.
          </p>
        </>
      )}
    </div>
  );
}
