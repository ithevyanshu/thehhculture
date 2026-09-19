import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, ShieldCheck, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { Artwork } from '../../components/Artwork';
import { useDialog } from '../../components/Dialog';
import { Pagination, Spinner } from '../../components/ui';
import { PERMISSIONS, type Permission } from '../../lib/permissions';
import type { Paged, Role } from '../../lib/types';

interface AdminUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
  permissions: string[];
  disabled: boolean;
  mustChangePassword: boolean;
  onboarded: boolean;
  createdAt: string;
  _count: { follows: number; likes: number; playlists: number };
}

type StaffRole = 'USER' | 'SUB_ADMIN' | 'ADMIN';
type Patch = { role?: StaffRole; permissions?: string[]; disabled?: boolean };

const ROLE_LABEL: Record<StaffRole, string> = { USER: 'User', SUB_ADMIN: 'Sub-admin', ADMIN: 'Admin' };

/** Tick boxes for a sub-admin's sections, saved together. */
function PermissionsEditor({ user, onSave, busy }: { user: AdminUser; onSave: (permissions: string[]) => void; busy: boolean }) {
  const [picked, setPicked] = useState<string[]>(user.permissions);
  const toggle = (p: Permission) => setPicked(picked.includes(p) ? picked.filter((x) => x !== p) : [...picked, p]);
  const dirty = [...picked].sort().join() !== [...user.permissions].sort().join();
  return (
    <div className="bg-paper px-4 py-3">
      <p className="label">What can @{user.username} manage?</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {PERMISSIONS.map((p) => (
          <label key={p.value} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={picked.includes(p.value)} onChange={() => toggle(p.value)} />
            {p.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary !px-3 !py-1.5" disabled={!dirty || busy} onClick={() => onSave(picked)}>
          Save access
        </button>
        <span className="text-xs text-dim">
          {picked.length ? 'Changes apply straight away, no sign-out needed.' : 'With nothing ticked they only see the Overview.'}
        </span>
      </div>
    </div>
  );
}

export function UsersAdmin() {
  const { user: me } = useAuth();
  const isAdmin = me?.role === 'ADMIN';
  const dialog = useDialog();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPerms, setOpenPerms] = useState<string | null>(null);
  const [reset, setReset] = useState<{ username: string; password: string; copied: boolean } | null>(null);

  const params = { q, role, status, page, limit: 25 };
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => api<Paged<AdminUser>>('/admin/users', { query: params }),
    placeholderData: (prev) => prev,
  });

  /** Sub-admins may only act on regular users. */
  const canManage = (u: AdminUser) => u.id !== me?.id && (isAdmin || u.role === 'USER');

  const run = async (userId: string, fn: () => Promise<unknown>) => {
    setBusy(userId);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusy(null);
    }
  };

  const update = async (u: AdminUser, patch: Patch) => {
    const action =
      patch.disabled === true
        ? `Disable @${u.username}? They'll be signed out and can't log in.`
        : patch.role === 'ADMIN'
          ? `Make @${u.username} an admin? They'll get full access to this panel, including users and roles.`
          : patch.role === 'SUB_ADMIN'
            ? `Make @${u.username} a sub-admin? They'll only get the sections you tick next.`
            : patch.role === 'USER'
              ? `Remove all admin access from @${u.username}?`
              : null;
    if (action && !(await dialog.confirm(action, { danger: patch.disabled === true || patch.role === 'USER', confirmLabel: 'Yes, do it' }))) return;
    await run(u.id, () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: patch }));
    if (patch.role === 'SUB_ADMIN') setOpenPerms(u.id);
    if (patch.role && patch.role !== 'SUB_ADMIN' && openPerms === u.id) setOpenPerms(null);
  };

  const resetPassword = async (u: AdminUser) => {
    const ok = await dialog.confirm(
      `Reset @${u.username}'s password? They'll be signed out everywhere and get a temporary password, which they must change when they next sign in.`,
      { confirmLabel: 'Reset password' },
    );
    if (!ok) return;
    await run(u.id, async () => {
      const { temporaryPassword } = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST' });
      setReset({ username: u.username, password: temporaryPassword, copied: false });
    });
  };

  const copy = async () => {
    if (!reset) return;
    try {
      await navigator.clipboard.writeText(reset.password);
      setReset({ ...reset, copied: true });
    } catch {
      // Clipboard blocked (e.g. embedded browser): the password is selectable on screen.
    }
  };

  return (
    <div>
      {reset && (
        <div className="mb-5 border-2 border-ink bg-neon p-4 shadow-hard" role="status">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-1 shrink-0" size={18} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">Temporary password for @{reset.username}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="border-2 border-ink bg-surface px-3 py-1.5 font-mono text-lg tracking-wider select-all">{reset.password}</code>
                <button className="btn-ghost !px-3 !py-1.5" onClick={copy}>
                  {reset.copied ? <Check size={14} /> : <Copy size={14} />} {reset.copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-sm">
                Send it to them privately. It's shown only this once. They'll be asked to choose their own password when they sign in.
              </p>
            </div>
            <button aria-label="Dismiss" className="p-1 hover:bg-ink/10" onClick={() => setReset(null)}>
              <X size={16} />
            </button>
          </div>
        </div>
      )}

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
        <select
          className="input !w-auto"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="USER">Users</option>
          <option value="SUB_ADMIN">Sub-admins</option>
          <option value="ADMIN">Admins</option>
        </select>
        <select
          className="input !w-auto"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
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
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="mono border-b-2 border-ink bg-paper">
                <tr>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2">Activity</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Password</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => {
                  const isMe = u.id === me?.id;
                  const manage = canManage(u);
                  const staffRole: StaffRole = u.role === 'ADMIN' || u.role === 'SUB_ADMIN' ? u.role : 'USER';
                  return (
                    <Fragment key={u.id}>
                      <tr className={`border-b border-dashed border-ink/25 last:border-b-0 ${u.disabled ? 'bg-surface-2 text-muted' : ''}`}>
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
                          {isAdmin ? (
                            <div className="flex items-center gap-1.5">
                              <select
                                className="input !w-auto !py-1"
                                value={staffRole}
                                disabled={isMe || busy === u.id}
                                onChange={(e) => update(u, { role: e.target.value as StaffRole })}
                                aria-label={`Role for ${u.username}`}
                              >
                                <option value="USER">User</option>
                                <option value="SUB_ADMIN">Sub-admin</option>
                                <option value="ADMIN">Admin</option>
                              </select>
                              {u.role === 'SUB_ADMIN' && (
                                <button
                                  className={`mono flex items-center gap-1 border-2 border-ink px-2 py-1 ${openPerms === u.id ? 'bg-ink text-paper' : 'hover:bg-neon'}`}
                                  onClick={() => setOpenPerms(openPerms === u.id ? null : u.id)}
                                  aria-expanded={openPerms === u.id}
                                  title="Choose which sections they can manage"
                                >
                                  <ShieldCheck size={12} /> {u.permissions.length}
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="mono">{ROLE_LABEL[staffRole]}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            className={`mono border-2 border-ink px-2 py-1 ${u.disabled ? 'bg-red text-paper' : 'bg-surface hover:bg-neon'} disabled:opacity-40`}
                            disabled={!manage || busy === u.id}
                            onClick={() => update(u, { disabled: !u.disabled })}
                            title={u.disabled ? 'Click to re-enable' : 'Click to disable'}
                          >
                            {u.disabled ? 'Disabled' : 'Active'}
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          {manage ? (
                            <button
                              className="mono flex items-center gap-1 border-2 border-ink px-2 py-1 hover:bg-neon disabled:opacity-40"
                              disabled={busy === u.id}
                              onClick={() => resetPassword(u)}
                            >
                              <KeyRound size={12} /> Reset
                            </button>
                          ) : (
                            <span className="text-xs text-dim">{isMe ? 'Use Settings' : '-'}</span>
                          )}
                          {u.mustChangePassword && <p className="mt-1 text-xs text-saffron-soft">Temporary, not changed yet</p>}
                        </td>
                      </tr>
                      {isAdmin && u.role === 'SUB_ADMIN' && openPerms === u.id && (
                        <tr className="border-b border-dashed border-ink/25">
                          <td colSpan={6} className="p-0">
                            <PermissionsEditor
                              key={u.permissions.join()}
                              user={u}
                              busy={busy === u.id}
                              onSave={(permissions) => run(u.id, () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { permissions } }))}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {data.items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted">
                      No users match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination meta={data.meta} onPage={setPage} />
          <p className="mt-3 text-xs text-dim">
            {isAdmin
              ? "Changing a role, disabling an account or resetting a password signs that user out everywhere. Sub-admins only see the sections you tick for them. You can't change your own role or disable yourself."
              : 'As a sub-admin you can disable and reset passwords for regular users. Admins and sub-admins are managed by full admins.'}
          </p>
        </>
      )}
    </div>
  );
}
