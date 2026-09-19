import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Pagination, Spinner } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import {
  SUGGESTION_STATUS_LABEL,
  SUGGESTION_TYPES,
  type PageMeta,
  type Suggestion,
  type SuggestionStatus,
  type SuggestionType,
} from '../../lib/types';

interface AdminSuggestion extends Suggestion {
  user: { id: string; username: string; displayName: string; email: string };
}

const STATUSES: SuggestionStatus[] = ['NEW', 'PLANNED', 'DONE', 'DISMISSED'];
const STATUS_STYLE: Record<SuggestionStatus, string> = {
  NEW: 'bg-surface',
  PLANNED: 'bg-saffron',
  DONE: 'bg-neon',
  DISMISSED: 'bg-surface-3',
};
const typeLabel = (t: SuggestionType) => SUGGESTION_TYPES.find((x) => x.value === t)?.label ?? t;

function SuggestionCard({ s, onChanged }: { s: AdminSuggestion; onChanged: () => void }) {
  const [note, setNote] = useState(s.adminNote ?? '');
  const [busy, setBusy] = useState(false);
  const dialog = useDialog();

  const patch = async (body: { status?: SuggestionStatus; adminNote?: string }) => {
    setBusy(true);
    try {
      await api(`/admin/suggestions/${s.id}`, { method: 'PATCH', body });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`border-2 border-ink bg-surface shadow-hard-sm ${s.status === 'DISMISSED' ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-ink/25 px-4 py-2">
        <span className="mono bg-ink px-1.5 py-0.5 text-paper">{typeLabel(s.type)}</span>
        <span className="mono text-muted">
          @{s.user.username} · {new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
        {s.contextUrl && (
          <Link to={s.contextUrl} className="mono ml-auto truncate underline decoration-2 underline-offset-2 hover:text-saffron-soft">
            from {s.contextUrl}
          </Link>
        )}
      </div>
      <p className="px-4 py-3 whitespace-pre-line">{s.message}</p>
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-dashed border-ink/25 px-4 py-2.5">
        <div className="inline-flex border-2 border-ink" role="group" aria-label="Status">
          {STATUSES.map((st) => (
            <button
              key={st}
              disabled={busy}
              onClick={() => st !== s.status && patch({ status: st })}
              className={`mono px-2.5 py-1 ${s.status === st ? `${STATUS_STYLE[st]} outline-2 -outline-offset-4 outline-ink` : 'bg-surface hover:bg-neon'}`}
            >
              {SUGGESTION_STATUS_LABEL[st]}
            </button>
          ))}
        </div>
        <input
          className="input !w-auto min-w-0 flex-1 !py-1.5"
          placeholder="Reply to the user (they see this)…"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <button className="btn-ghost !px-3 !py-1.5" disabled={busy || note === (s.adminNote ?? '')} onClick={() => patch({ adminNote: note })}>
          Save reply
        </button>
        <button
          className="p-1.5 hover:bg-red hover:text-paper"
          aria-label="Delete suggestion"
          onClick={async () => {
            if (!(await dialog.confirm('Delete this suggestion?'))) return;
            await api(`/admin/suggestions/${s.id}`, { method: 'DELETE' });
            onChanged();
          }}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </li>
  );
}

export function SuggestionsAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SuggestionStatus | ''>('NEW');
  const [type, setType] = useState<SuggestionType | ''>('');
  const [page, setPage] = useState(1);
  const params = { status, type, page, limit: 20 };

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'suggestions', params],
    queryFn: () =>
      api<{ items: AdminSuggestion[]; meta: PageMeta; counts: Partial<Record<SuggestionStatus, number>> }>('/admin/suggestions', {
        query: params,
      }),
    placeholderData: (prev) => prev,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'suggestions'] });
    qc.invalidateQueries({ queryKey: ['admin', 'stats'] });
  };

  return (
    <div>
      <p className="mb-5 max-w-2xl text-muted">
        What listeners think is missing. Replies and status changes show up for the user in their suggestion box.
      </p>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {(['', ...STATUSES] as const).map((st) => (
          <button
            key={st || 'all'}
            onClick={() => {
              setStatus(st);
              setPage(1);
            }}
            className={`chip !px-3 !py-1.5 ${status === st ? 'chip-active' : ''}`}
          >
            {st ? SUGGESTION_STATUS_LABEL[st] : 'All'}
            {st && data?.counts[st] ? <span className="ml-1 opacity-70">({data.counts[st]})</span> : null}
          </button>
        ))}
        <select
          className="input ml-auto !w-auto !py-1.5"
          value={type}
          onChange={(e) => {
            setType(e.target.value as SuggestionType | '');
            setPage(1);
          }}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          {SUGGESTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading || !data ? (
        <Spinner />
      ) : data.items.length === 0 ? (
        <div className="border-2 border-dashed border-ink/40 px-6 py-12 text-center">
          <p className="display text-3xl">Inbox zero</p>
          <p className="mt-1 text-sm text-muted">Nothing here with these filters.</p>
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {data.items.map((s) => (
              <SuggestionCard key={`${s.id}-${s.updatedAt}`} s={s} onChanged={refresh} />
            ))}
          </ul>
          <Pagination meta={data.meta} onPage={setPage} />
        </>
      )}
    </div>
  );
}
