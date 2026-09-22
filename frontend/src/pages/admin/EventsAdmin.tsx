import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Pencil, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useRegions } from '../../lib/queries';
import { HandleInput, type HandleRef } from '../../components/HandleInput';
import { useDialog } from '../../components/Dialog';
import { Empty, Pagination, Spinner } from '../../components/ui';
import { eventWhen } from '../../lib/format';
import { EVENT_STATUS_LABEL, type EventStatus, type Paged } from '../../lib/types';

/** What the admin list and the form both work with: a card plus the editable-only fields. */
interface AdminEvent {
  id: string;
  slug: string;
  title: string;
  kind: string | null;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  venue: string | null;
  address: string | null;
  regionId: string | null;
  region: { slug: string; name: string } | null;
  posterUrl: string | null;
  ticketUrl: string | null;
  priceFrom: number | null;
  status: EventStatus;
  featured: boolean;
  lineup: { order: number; artist: HandleRef & { imageUrl?: string | null } }[];
}

type When = 'all' | 'upcoming' | 'past';

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-dim">{hint}</span>}
    </label>
  );
}

/** ISO timestamp -> the value a datetime-local input wants, in the browser's timezone. */
function dtLocal(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const blank = {
  title: '',
  slug: '',
  kind: '',
  description: '',
  startsAt: '',
  endsAt: '',
  allDay: false,
  venue: '',
  address: '',
  regionId: '',
  posterUrl: '',
  ticketUrl: '',
  priceFrom: '',
  status: 'SCHEDULED' as EventStatus,
  featured: false,
};

function EventForm({ event, onDone }: { event: AdminEvent | null; onDone: () => void }) {
  const qc = useQueryClient();
  const regions = useRegions();
  const [form, setForm] = useState(blank);
  const [lineup, setLineup] = useState<HandleRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) {
      setForm(blank);
      setLineup([]);
      return;
    }
    setForm({
      title: event.title,
      slug: event.slug,
      kind: event.kind ?? '',
      description: event.description ?? '',
      startsAt: dtLocal(event.startsAt),
      endsAt: dtLocal(event.endsAt),
      allDay: event.allDay,
      venue: event.venue ?? '',
      address: event.address ?? '',
      regionId: event.regionId ?? '',
      posterUrl: event.posterUrl ?? '',
      ticketUrl: event.ticketUrl ?? '',
      priceFrom: event.priceFrom === null ? '' : String(event.priceFrom),
      status: event.status,
      featured: event.featured,
    });
    setLineup(event.lineup.map((l) => l.artist));
  }, [event]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(event ? `/admin/events/${event.id}` : '/admin/events', { method: event ? 'PATCH' : 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'events'] });
      qc.invalidateQueries({ queryKey: ['events'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save this event'),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.startsAt) return setError('An event needs a start date');
    save.mutate({
      ...form,
      slug: form.slug || undefined,
      priceFrom: form.priceFrom === '' ? '' : Number(form.priceFrom),
      artistIds: lineup.map((a) => a.id),
    });
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} className="mb-8 border-2 border-ink bg-surface p-4 shadow-hard">
      <div className="mb-4 flex items-center gap-3">
        <h3 className="display text-2xl">{event ? `Edit ${event.title}` : 'New event'}</h3>
        <button type="button" className="btn-ghost ml-auto !px-3 !py-1.5" onClick={onDone}>
          <X size={14} /> Cancel
        </button>
      </div>

      <div className="space-y-4">
        <Field label="Title *">
          <input className="input" value={form.title} onChange={set('title')} required maxLength={150} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts *" hint="Tick “date only” below if the time isn't announced yet.">
            <input type="datetime-local" className="input" value={form.startsAt} onChange={set('startsAt')} required />
          </Field>
          <Field label="Ends" hint="Only for events running more than one day.">
            <input type="datetime-local" className="input" value={form.endsAt} onChange={set('endsAt')} />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <label className="mono flex items-center gap-2">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} /> Date only (hide the time)
          </label>
          <label className="mono flex items-center gap-2">
            <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} /> Feature it (poster on the
            events page)
          </label>
          <label className="mono flex items-center gap-2">
            Status
            <select className="input !w-auto !py-1" value={form.status} onChange={set('status')}>
              {(Object.keys(EVENT_STATUS_LABEL) as EventStatus[]).map((s) => (
                <option key={s} value={s}>
                  {EVENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <Field label="Line-up" hint="In billing order — the first one is shown as the headliner.">
          <HandleInput value={lineup} onChange={setLineup} placeholder="Type a name or @handle…" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue">
            <input className="input" value={form.venue} onChange={set('venue')} placeholder="Antisocial, Bandra" maxLength={150} />
          </Field>
          <Field label="City">
            <select className="input" value={form.regionId} onChange={set('regionId')}>
              <option value="">No city</option>
              {regions.data?.items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Address" hint="Shown under the venue and used for the map link.">
          <input className="input" value={form.address} onChange={set('address')} maxLength={300} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kind" hint="Festival, Tour date, Album launch…">
            <input className="input" value={form.kind} onChange={set('kind')} maxLength={40} />
          </Field>
          <Field label="Cheapest ticket (₹)">
            <input className="input" type="number" min={0} value={form.priceFrom} onChange={set('priceFrom')} />
          </Field>
          <Field label="Slug" hint="Left blank, it comes from the title.">
            <input className="input" value={form.slug} onChange={set('slug')} maxLength={80} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Poster URL">
            <input className="input" value={form.posterUrl} onChange={set('posterUrl')} placeholder="https://…" />
          </Field>
          <Field label="Tickets URL">
            <input className="input" value={form.ticketUrl} onChange={set('ticketUrl')} placeholder="https://…" />
          </Field>
        </div>

        <Field label="What it is">
          <textarea className="input min-h-28" value={form.description} onChange={set('description')} maxLength={4000} />
        </Field>
      </div>

      {error && <p className="mt-4 text-sm text-red">{error}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : event ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}

export function EventsAdmin() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [when, setWhen] = useState<When>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AdminEvent | null | undefined>(undefined); // undefined = form closed

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'events', when, q, page],
    queryFn: () => api<Paged<AdminEvent>>('/admin/events', { query: { when, page, limit: 20, ...(q.trim() && { q: q.trim() }) } }),
    placeholderData: (prev) => prev,
  });

  const remove = async (event: AdminEvent) => {
    const ok = await dialog.confirm(`Delete “${event.title}”? This can't be undone.`, { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    await api(`/admin/events/${event.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['admin', 'events'] });
    qc.invalidateQueries({ queryKey: ['events'] });
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="display text-3xl">Events</h2>
          <p className="text-sm text-muted">Gigs, festivals, tour dates and launches. They show on /events, on the line-up's artist pages, and on the front page.</p>
        </div>
        {editing === undefined && (
          <button className="btn-primary ml-auto" onClick={() => setEditing(null)}>
            <CalendarPlus size={14} /> New event
          </button>
        )}
      </div>

      {editing !== undefined && <EventForm event={editing} onDone={() => setEditing(undefined)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['all', 'upcoming', 'past'] as When[]).map((w) => (
          <button
            key={w}
            className={`chip ${when === w ? 'chip-active' : ''}`}
            onClick={() => {
              setWhen(w);
              setPage(1);
            }}
          >
            {w === 'all' ? 'All' : w === 'upcoming' ? 'Coming up' : 'Past'}
          </button>
        ))}
        <input
          className="input !w-auto min-w-56 flex-1"
          placeholder="Search by title or venue…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {isLoading && !data ? (
        <Spinner />
      ) : !data?.items.length ? (
        <Empty title="No events yet">Add the first one with “New event”.</Empty>
      ) : (
        <>
          <div className="border-2 border-ink bg-surface">
            {data.items.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-3 border-b border-dashed border-ink/25 px-3 py-2 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold uppercase">
                    {e.title}
                    {e.featured && <span className="mono ml-2 bg-neon px-1 normal-case">featured</span>}
                    {e.status !== 'SCHEDULED' && <span className="mono ml-2 bg-red px-1 normal-case text-paper">{EVENT_STATUS_LABEL[e.status]}</span>}
                  </p>
                  <p className="mono truncate text-muted">
                    {eventWhen(e)}
                    {(e.venue || e.region) && ` · ${[e.venue, e.region?.name].filter(Boolean).join(', ')}`}
                    {!!e.lineup.length && ` · ${e.lineup.map((l) => l.artist.name).join(', ')}`}
                  </p>
                </div>
                <button className="btn-ghost !px-2 !py-1" onClick={() => setEditing(e)} aria-label={`Edit ${e.title}`}>
                  <Pencil size={14} />
                </button>
                <button className="btn-ghost !px-2 !py-1 hover:!bg-red hover:!text-paper" onClick={() => remove(e)} aria-label={`Delete ${e.title}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </section>
  );
}
