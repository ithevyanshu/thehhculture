import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { at } from '../../lib/format';
import { Spinner } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { HandleInput, type HandleRef } from '../../components/HandleInput';
import { SHOW_ROLE_LABEL, type ShowCard, type ShowRole } from '../../lib/types';

interface AdminSeason {
  id: string;
  number: number;
  year: number | null;
  title: string | null;
  cast: { role: ShowRole; placement: string | null; artist: HandleRef & { imageUrl: string | null } }[];
}
interface AdminShow {
  id: string;
  slug: string;
  name: string;
  network: string | null;
  description: string | null;
  logoUrl: string | null;
  seasons: AdminSeason[];
}

const ROLES = Object.keys(SHOW_ROLE_LABEL) as ShowRole[];
const errMsg = (err: unknown) =>
  err instanceof ApiError
    ? err.details
      ? `${err.message}: ${Object.values(err.details).flat().join(' ')}`
      : err.message
    : 'Something went wrong';

function useInvalidateShows() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin', 'shows'] }),
      qc.invalidateQueries({ queryKey: ['admin', 'show'] }),
      qc.invalidateQueries({ queryKey: ['shows'] }),
      qc.invalidateQueries({ queryKey: ['show'] }),
      qc.invalidateQueries({ queryKey: ['home'] }),
      qc.invalidateQueries({ queryKey: ['artist'] }),
    ]);
}

// ---------- Season card (details + cast) ----------

function SeasonEditor({ season, onChanged }: { season: AdminSeason; onChanged: () => void }) {
  const [meta, setMeta] = useState({ number: season.number, year: season.year ?? '', title: season.title ?? '' });
  const [cast, setCast] = useState(season.cast.map((c) => ({ role: c.role, placement: c.placement ?? '', artist: c.artist as HandleRef })));
  const [newRole, setNewRole] = useState<ShowRole>('CONTESTANT');
  const dialog = useDialog();
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const dirtyCast =
    JSON.stringify(cast.map((c) => [c.artist.id, c.role, c.placement])) !==
    JSON.stringify(season.cast.map((c) => [c.artist.id, c.role, c.placement ?? '']));
  const dirtyMeta = meta.number !== season.number || String(meta.year) !== String(season.year ?? '') || meta.title !== (season.title ?? '');

  const save = async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (dirtyMeta) await api(`/admin/seasons/${season.id}`, { method: 'PATCH', body: meta });
      if (dirtyCast)
        await api(`/admin/seasons/${season.id}/cast`, {
          method: 'PUT',
          body: { cast: cast.map((c) => ({ artistId: c.artist.id, role: c.role, placement: c.placement })) },
        });
      setStatus({ ok: true, msg: 'Saved' });
      onChanged();
    } catch (err) {
      setStatus({ ok: false, msg: errMsg(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-2 border-ink bg-surface shadow-hard-sm">
      <div className="flex flex-wrap items-end gap-2 border-b-2 border-dashed border-ink/30 p-3">
        <span className="display pb-1 text-3xl">S{meta.number || '?'}</span>
        <label className="w-20">
          <span className="label !mb-0.5">Season #</span>
          <input className="input !py-1.5" type="number" min={1} value={meta.number} onChange={(e) => setMeta({ ...meta, number: Number(e.target.value) })} />
        </label>
        <label className="w-24">
          <span className="label !mb-0.5">Year</span>
          <input className="input !py-1.5" type="number" min={1990} max={2100} value={meta.year} onChange={(e) => setMeta({ ...meta, year: e.target.value })} />
        </label>
        <label className="min-w-40 flex-1">
          <span className="label !mb-0.5">Title (optional)</span>
          <input className="input !py-1.5" placeholder='e.g. "Hustle 2.0"' value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
        </label>
        <button
          type="button"
          className="p-2 hover:bg-red hover:text-paper"
          aria-label={`Delete season ${season.number}`}
          onClick={async () => {
            if (!(await dialog.confirm(`Delete season ${season.number} and its cast?`))) return;
            await api(`/admin/seasons/${season.id}`, { method: 'DELETE' });
            onChanged();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="space-y-2 p-3">
        <span className="label">Cast</span>
        {cast.length === 0 && <p className="text-sm text-muted italic">No one added yet.</p>}
        <ul className="space-y-1">
          {cast.map((c, i) => (
            <li key={`${c.artist.id}-${i}`} className="flex items-center gap-2">
              <select
                className="input !w-40 !py-1"
                value={c.role}
                onChange={(e) => setCast(cast.map((x, j) => (j === i ? { ...x, role: e.target.value as ShowRole } : x)))}
                aria-label={`Role for ${at(c.artist)}`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {SHOW_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <input
                className="input !w-24 !py-1"
                placeholder="Finish"
                title='Placement, e.g. "3rd", "6-10", "Eliminated - Ep 2"'
                value={c.placement}
                onChange={(e) => setCast(cast.map((x, j) => (j === i ? { ...x, placement: e.target.value } : x)))}
                aria-label={`Placement for ${at(c.artist)}`}
              />
              <span className="mono !normal-case">{at(c.artist)}</span>
              <span className="truncate text-sm text-muted">{c.artist.name}</span>
              <button
                type="button"
                className="ml-auto p-1.5 hover:bg-neon"
                onClick={() => setCast(cast.filter((_, j) => j !== i))}
                aria-label={`Remove ${at(c.artist)}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-start gap-2 pt-1">
          <select className="input !w-40" value={newRole} onChange={(e) => setNewRole(e.target.value as ShowRole)} aria-label="Role for new cast member">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {SHOW_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <div className="min-w-60 flex-1">
            <HandleInput
              single
              placeholder={`Add ${SHOW_ROLE_LABEL[newRole].toLowerCase()} by @handle…`}
              onPick={(artist) => {
                if (!cast.some((c) => c.artist.id === artist.id && c.role === newRole)) setCast([...cast, { artist, role: newRole, placement: '' }]);
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t-2 border-dashed border-ink/30 px-3 py-2">
        <button type="button" className="btn-primary !px-4 !py-2" disabled={busy || (!dirtyCast && !dirtyMeta)} onClick={save}>
          {busy ? 'Saving…' : 'Save season'}
        </button>
        {status && <span className={`text-sm ${status.ok ? 'text-saffron-soft' : 'text-red'}`}>{status.msg}</span>}
        {(dirtyCast || dirtyMeta) && !status && <span className="mono text-muted">Unsaved changes</span>}
      </div>
    </li>
  );
}

// ---------- One show ----------

function ShowEditor({ id, onBack }: { id: string; onBack: () => void }) {
  const invalidate = useInvalidateShows();
  const dialog = useDialog();
  const { data, refetch } = useQuery({ queryKey: ['admin', 'show', id], queryFn: () => api<{ show: AdminShow }>(`/admin/shows/${id}`) });
  const [form, setForm] = useState({ name: '', network: '', description: '', logoUrl: '' });
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [newSeason, setNewSeason] = useState({ number: '', year: '', title: '' });

  useEffect(() => {
    if (!data) return;
    const s = data.show;
    setForm({ name: s.name, network: s.network ?? '', description: s.description ?? '', logoUrl: s.logoUrl ?? '' });
    setNewSeason((n) => ({ ...n, number: String((s.seasons[0]?.number ?? 0) + 1) }));
  }, [data]);

  if (!data) return <Spinner />;
  const { show } = data;
  const changed = async () => {
    await invalidate();
    await refetch();
  };

  const saveShow = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      await api(`/admin/shows/${id}`, { method: 'PATCH', body: form });
      setStatus({ ok: true, msg: 'Saved' });
      changed();
    } catch (err) {
      setStatus({ ok: false, msg: errMsg(err) });
    }
  };

  const addSeason = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      await api(`/admin/shows/${id}/seasons`, { method: 'POST', body: newSeason });
      setNewSeason({ number: '', year: '', title: '' });
      changed();
    } catch (err) {
      setStatus({ ok: false, msg: errMsg(err) });
    }
  };

  return (
    <div>
      <button onClick={onBack} className="mono mb-4 inline-flex items-center gap-1 hover:text-saffron-soft">
        <ArrowLeft size={14} /> All shows
      </button>
      <form onSubmit={saveShow} className="mb-8 space-y-3 border-2 border-ink bg-surface p-4 shadow-hard">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-4xl">{show.name}</h2>
          <a href={`/shows/${show.slug}`} target="_blank" rel="noreferrer" className="mono underline">
            View /shows/{show.slug} ↗
          </a>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Name *</span>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            <span className="label">Network / platform</span>
            <input className="input" placeholder="MTV, YouTube…" value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Description</span>
            <textarea className="input min-h-20" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Logo / poster URL</span>
            <input className="input" type="url" value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary">Save show</button>
          <button
            type="button"
            className="btn-ghost hover:!bg-red hover:!text-paper"
            onClick={async () => {
              if (!(await dialog.confirm(`Delete "${show.name}" with all its seasons? Artists are kept.`))) return;
              await api(`/admin/shows/${id}`, { method: 'DELETE' });
              await invalidate();
              onBack();
            }}
          >
            <Trash2 size={14} /> Delete show
          </button>
          {status && <span className={`text-sm ${status.ok ? 'text-saffron-soft' : 'text-red'}`}>{status.msg}</span>}
        </div>
      </form>

      <h3 className="display mb-3 text-3xl">Seasons</h3>
      <form onSubmit={addSeason} className="mb-4 flex flex-wrap items-end gap-2 border-2 border-dashed border-ink p-3">
        <label className="w-24">
          <span className="label !mb-0.5">Season # *</span>
          <input className="input !py-1.5" type="number" min={1} required value={newSeason.number} onChange={(e) => setNewSeason({ ...newSeason, number: e.target.value })} />
        </label>
        <label className="w-24">
          <span className="label !mb-0.5">Year</span>
          <input className="input !py-1.5" type="number" min={1990} max={2100} value={newSeason.year} onChange={(e) => setNewSeason({ ...newSeason, year: e.target.value })} />
        </label>
        <label className="min-w-40 flex-1">
          <span className="label !mb-0.5">Title</span>
          <input className="input !py-1.5" value={newSeason.title} onChange={(e) => setNewSeason({ ...newSeason, title: e.target.value })} />
        </label>
        <button className="btn-ghost !py-2">
          <Plus size={14} /> Add season
        </button>
      </form>
      <ul className="space-y-4">
        {show.seasons.map((s) => (
          // Re-mount when the saved season changes so drafts reset to the server state.
          <SeasonEditor key={`${s.id}:${s.number}:${s.year}:${s.title}:${s.cast.map((c) => c.artist.id + c.role).join()}`} season={s} onChanged={changed} />
        ))}
      </ul>
    </div>
  );
}

// ---------- List ----------

export function ShowsAdmin() {
  const invalidate = useInvalidateShows();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', network: '' });
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'shows'], queryFn: () => api<{ items: ShowCard[] }>('/admin/shows') });

  if (selected) return <ShowEditor id={selected} onBack={() => setSelected(null)} />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const { show } = await api<{ show: { id: string } }>('/admin/shows', { method: 'POST', body: draft });
      setDraft({ name: '', network: '' });
      await invalidate();
      setSelected(show.id);
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div>
      <form onSubmit={create} className="mb-6 flex flex-wrap items-end gap-2">
        <label className="min-w-56 flex-1">
          <span className="label">New show</span>
          <input className="input" required placeholder='e.g. "Hip Hop India"' value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="w-48">
          <span className="label">Network</span>
          <input className="input" placeholder="MTV, YouTube…" value={draft.network} onChange={(e) => setDraft({ ...draft, network: e.target.value })} />
        </label>
        <button className="btn-primary">
          <Plus size={14} /> Create show
        </button>
        {error && <p className="w-full text-sm text-red">{error}</p>}
      </form>

      {isLoading || !data ? (
        <Spinner />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.items.map((s) => (
            <li key={s.id}>
              <button onClick={() => setSelected(s.id)} className="w-full border-2 border-ink bg-surface p-4 text-left shadow-hard-sm transition hover:-translate-y-0.5 hover:shadow-hard">
                <p className="mono text-muted">{s.network ?? 'Rap show'}</p>
                <p className="display text-3xl">{s.name}</p>
                <p className="mono mt-1">
                  {s._count.seasons} season{s._count.seasons === 1 ? '' : 's'}
                  {s.latestSeason?.cast.length ? ` · latest winner: ${s.latestSeason.cast.map((c) => at(c.artist)).join(', ')}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
