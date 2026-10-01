import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { Artwork } from '../../components/Artwork';
import { useDialog } from '../../components/Dialog';
import { Empty, Pagination, Spinner } from '../../components/ui';
import type { Paged } from '../../lib/types';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

interface InviteRequest {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: Status;
  statusNote: string | null;
  /** What they wrote about themselves when asking. */
  inviteNote: string | null;
  instagramUrl: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: { username: string } | null;
  follows: { artist: { id: string; slug: string; name: string; handle: string | null; imageUrl: string | null } }[];
  favoriteGenres: { slug: string; name: string }[];
  favoriteRegions: { slug: string; name: string }[];
}

const TABS: { value: Status; label: string }[] = [
  { value: 'PENDING', label: 'Waiting' },
  { value: 'APPROVED', label: 'Let in' },
  { value: 'REJECTED', label: 'Turned down' },
];

/** Admin-created account: the password is shown once, to pass on by hand. */
function InviteDirect({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ email: '', username: '', displayName: '' });
  const [made, setMade] = useState<{ username: string; password: string; copied: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user, temporaryPassword } = await api<{ user: { username: string }; temporaryPassword: string }>('/admin/invites', {
        method: 'POST',
        body: { ...form, displayName: form.displayName || undefined },
      });
      setMade({ username: user.username, password: temporaryPassword, copied: false });
      setForm({ email: '', username: '', displayName: '' });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that account');
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <div className="mb-6 border-2 border-ink bg-neon p-4 shadow-hard">
        <p className="font-bold">@{made.username} is in.</p>
        <p className="mt-1 text-sm">Send them this password — it's shown once, and they'll have to change it when they sign in.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <code className="mono border-2 border-ink bg-paper px-3 py-2">{made.password}</code>
          <button
            className="btn-ghost !px-3 !py-2"
            onClick={() => {
              navigator.clipboard.writeText(made.password).then(() => setMade({ ...made, copied: true })).catch(() => undefined);
            }}
          >
            {made.copied ? <Check size={14} /> : <Copy size={14} />} {made.copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn-ghost !px-3 !py-2" onClick={() => setMade(null)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mb-6 border-2 border-dashed border-ink/40 p-4">
      <p className="label">Let someone in directly</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-56 flex-1">
          <span className="label !mb-0.5">Email</span>
          <input className="input" type="email" value={form.email} onChange={set('email')} required />
        </label>
        <label className="min-w-40 flex-1">
          <span className="label !mb-0.5">Username</span>
          <input className="input" value={form.username} onChange={set('username')} required minLength={3} maxLength={24} />
        </label>
        <label className="min-w-40 flex-1">
          <span className="label !mb-0.5">Display name</span>
          <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="Optional" maxLength={50} />
        </label>
        <button className="btn-primary" disabled={busy}>
          <UserPlus size={14} /> {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red">{error}</p>}
    </form>
  );
}

export function InvitesAdmin() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [status, setStatus] = useState<Status>('PENDING');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'invites', status, page],
    queryFn: () => api<Paged<InviteRequest> & { pending: number }>('/admin/invites', { query: { status, page, limit: 20 } }),
    placeholderData: (prev) => prev,
  });

  const decide = async (req: InviteRequest, decision: 'APPROVED' | 'REJECTED') => {
    const artists = req.follows.length;
    const ok = await dialog.confirm(
      decision === 'APPROVED'
        ? `Let @${req.username} in? They can sign in straight away${artists ? `, already following ${artists} artist${artists === 1 ? '' : 's'}` : ''}.`
        : `Turn down @${req.username}? They'll be told when they try to sign in.`,
      { danger: decision === 'REJECTED', confirmLabel: decision === 'APPROVED' ? 'Let them in' : 'Turn down' },
    );
    if (!ok) return;
    setBusy(req.id);
    setError(null);
    try {
      await api(`/admin/invites/${req.id}`, { method: 'POST', body: { decision } });
      await qc.invalidateQueries({ queryKey: ['admin', 'invites'] });
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h2 className="display mb-1 text-3xl">Requests to join</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        The site is invite only. People ask to join and wait here until you let them in — there's no email, so they simply sign in once accepted, already
        following the artists they picked.
      </p>

      <InviteDirect onCreated={() => qc.invalidateQueries({ queryKey: ['admin', 'invites'] })} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            className={`chip ${status === t.value ? 'chip-active' : ''}`}
            onClick={() => {
              setStatus(t.value);
              setPage(1);
            }}
          >
            {t.label}
            {t.value === 'PENDING' && !!data?.pending && <span className="mono ml-2 bg-red px-1.5 text-paper">{data.pending}</span>}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-sm text-red">{error}</p>}

      {isLoading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title={status === 'PENDING' ? 'Nobody waiting' : 'Nothing here'} />
      ) : (
        <>
          <div className="space-y-3">
            {data.items.map((req) => (
              <article key={req.id} className="border-2 border-ink bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold uppercase">
                      {req.displayName} <span className="mono normal-case text-muted">@{req.username}</span>
                    </p>
                    <p className="mono text-muted">
                      {req.email}
                      {req.instagramUrl && ` · ${req.instagramUrl}`}
                      {` · asked ${new Date(req.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`}
                    </p>
                  </div>
                  {req.status === 'PENDING' ? (
                    <div className="flex shrink-0 gap-2">
                      <button className="btn-primary !px-3 !py-1.5" disabled={busy === req.id} onClick={() => decide(req, 'APPROVED')}>
                        <Check size={14} /> Let in
                      </button>
                      <button className="btn-ghost !px-3 !py-1.5 hover:!bg-red hover:!text-paper" disabled={busy === req.id} onClick={() => decide(req, 'REJECTED')}>
                        <X size={14} /> Turn down
                      </button>
                    </div>
                  ) : (
                    <span className={`mono shrink-0 border-2 border-ink px-2 py-1 ${req.status === 'APPROVED' ? 'bg-neon' : 'bg-red text-paper'}`}>
                      {req.status === 'APPROVED' ? 'Let in' : 'Turned down'}
                      {req.reviewedBy && ` by @${req.reviewedBy.username}`}
                    </span>
                  )}
                </div>

                {req.inviteNote && <p className="mt-3 border-l-2 border-saffron pl-3 text-sm whitespace-pre-line">{req.inviteNote}</p>}

                {(req.follows.length > 0 || req.favoriteGenres.length > 0 || req.favoriteRegions.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {req.follows.map(({ artist }) => (
                      <span key={artist.id} className="flex items-center gap-2 border-2 border-ink bg-paper py-0.5 pr-2 pl-0.5">
                        <span className="size-6 border border-ink">
                          <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} live />
                        </span>
                        <span className="text-xs font-bold uppercase">{artist.name}</span>
                      </span>
                    ))}
                    {req.favoriteGenres.map((g) => (
                      <span key={g.slug} className="chip !py-0.5">
                        {g.name}
                      </span>
                    ))}
                    {req.favoriteRegions.map((r) => (
                      <span key={r.slug} className="chip !py-0.5">
                        {r.name}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </section>
  );
}
