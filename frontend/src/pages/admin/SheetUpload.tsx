import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
import { api, ApiError, apiDownload, apiUpload } from '../../lib/api';
import { Spinner } from '../../components/ui';

type SheetKind = 'songs' | 'albums' | 'artists';
type RowAction = 'create' | 'update' | 'unchanged' | 'error';

interface SheetInfo {
  kind: SheetKind;
  label: string;
  note: string;
  columns: { header: string; hint: string; required: boolean; key: boolean }[];
}

interface RowPlan {
  row: number;
  action: RowAction;
  label: string;
  changes: Record<string, [unknown, unknown]>;
  error?: string;
}

interface Preview {
  kind: SheetKind;
  filename: string;
  rows: RowPlan[];
  counts: { create: number; update: number; unchanged: number; error: number };
}

/** Field names as the admin panel says them. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  handle: '@handle',
  realName: 'Real name',
  bio: 'Bio',
  activeSince: 'Active since',
  imageUrl: 'Photo',
  imageCredit: 'Photo credit',
  youtubeUrl: 'YouTube',
  spotifyUrl: 'Spotify',
  instagramUrl: 'Instagram',
  isProducer: 'Producer',
  regionId: 'City',
  genreSlugs: 'Genres',
  title: 'Title',
  type: 'Type',
  releaseDate: 'Release date',
  coverUrl: 'Cover',
  spotifyId: 'Spotify album',
  albumId: 'Album',
  trackNumber: 'Track #',
  durationSec: 'Duration',
  explicit: 'Explicit',
  lyricsUrl: 'Lyrics',
  spotifyTrackId: 'Spotify track',
  youtubeVideoId: 'YouTube video',
  featureArtistIds: 'Featuring',
  producerArtistIds: 'Produced by',
};

const show = (v: unknown) => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  const s = String(v);
  return s.length > 42 ? `${s.slice(0, 42)}…` : s;
};

const ACTION_STYLE: Record<RowAction, string> = {
  create: 'bg-neon',
  update: 'bg-surface',
  unchanged: 'bg-surface-2 text-muted',
  error: 'bg-red text-paper',
};

export function SheetUpload({ onApplied }: { onApplied: (message: string) => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<SheetKind>('songs');
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const info = useQuery({ queryKey: ['admin', 'sheets'], queryFn: () => api<{ kinds: SheetInfo[] }>('/admin/sheets') });
  const current = info.data?.kinds.find((k) => k.kind === kind);

  const reset = () => {
    setFile(null);
    setPlan(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const pick = async (picked: File | null) => {
    reset();
    if (!picked) return;
    setFile(picked);
    setBusy('preview');
    try {
      setPlan(await apiUpload<Preview>('/admin/sheets/preview', picked, { query: { kind, filename: picked.name } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that file');
    } finally {
      setBusy(null);
    }
  };

  const applyNow = async () => {
    if (!file) return;
    setBusy('apply');
    setError(null);
    try {
      await apiUpload('/admin/sheets/apply', file, { query: { kind, filename: file.name } });
      const { create, update } = plan!.counts;
      onApplied(`${file.name}: ${create} added, ${update} updated. Undo it below if that wasn't right.`);
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['artist'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply the file');
    } finally {
      setBusy(null);
    }
  };

  const counts = plan?.counts;
  const applicable = counts ? counts.create + counts.update : 0;

  return (
    <section>
      <h2 className="display mb-1 text-3xl">Update from a spreadsheet</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Edit songs, albums or artists in Excel and upload the file. You see every change before anything is saved, blank cells are left alone, and the
        whole upload can be undone afterwards.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['songs', 'albums', 'artists'] as SheetKind[]).map((k) => (
          <button
            key={k}
            className={`chip ${kind === k ? 'chip-active' : ''}`}
            onClick={() => {
              setKind(k);
              reset();
            }}
          >
            {info.data?.kinds.find((x) => x.kind === k)?.label ?? k}
          </button>
        ))}
        <button
          className="btn-ghost ml-auto !px-3 !py-1.5"
          onClick={() => apiDownload(`/admin/sheets/template/${kind}`, `dhhculture-${kind}-template.xlsx`)}
        >
          <Download size={14} /> Download template
        </button>
      </div>

      <div className="border-2 border-dashed border-ink bg-surface p-5">
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet size={18} />
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv"
            className="input !w-auto min-w-64 flex-1 !py-2"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            aria-label={`Upload a ${kind} spreadsheet`}
          />
          {file && (
            <button className="btn-ghost !px-3 !py-1.5" onClick={reset}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-dim">
          .xlsx or .csv, up to 8 MB and 400 changed rows per file.{' '}
          <button className="underline hover:text-ink" onClick={() => setShowHelp(!showHelp)}>
            {showHelp ? 'Hide' : 'What do the columns mean?'}
          </button>
        </p>

        {showHelp && current && (
          <div className="mt-3 border-2 border-ink bg-paper p-3">
            <p className="mb-2 text-sm">{current.note}</p>
            <table className="w-full text-left text-sm">
              <tbody>
                {current.columns.map((c) => (
                  <tr key={c.header} className="border-t border-dashed border-ink/20">
                    <td className="mono w-44 py-1 pr-3">
                      {c.header}
                      {c.required && <span className="text-red"> *</span>}
                    </td>
                    <td className="py-1 text-muted">{c.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {busy === 'preview' && <Spinner label="Reading the file" />}
      {error && (
        <p className="mt-4 flex items-start gap-2 border-2 border-red bg-red/10 px-3 py-2 text-sm text-red">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {plan && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="mono">
              {plan.counts.create} to add · {plan.counts.update} to update · {plan.counts.unchanged} unchanged
              {plan.counts.error ? ` · ${plan.counts.error} with errors` : ''}
            </p>
            <button className="btn-primary ml-auto" disabled={busy === 'apply' || !applicable} onClick={applyNow}>
              <Upload size={14} /> {busy === 'apply' ? 'Applying…' : `Apply ${applicable} change${applicable === 1 ? '' : 's'}`}
            </button>
          </div>
          {!!plan.counts.error && (
            <p className="mb-3 text-sm text-red">Rows with errors are skipped; the rest still apply. Fix them and upload again.</p>
          )}

          <div className="max-h-[30rem] overflow-y-auto border-2 border-ink">
            <table className="w-full text-left text-sm">
              <thead className="mono sticky top-0 border-b-2 border-ink bg-paper">
                <tr>
                  <th className="w-14 px-2 py-1.5">Row</th>
                  <th className="w-24 px-2 py-1.5">Action</th>
                  <th className="px-2 py-1.5">Item</th>
                  <th className="px-2 py-1.5">What changes</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((r) => (
                  <tr key={r.row} className="border-b border-dashed border-ink/25 align-top last:border-b-0">
                    <td className="mono px-2 py-1.5 text-muted">{r.row}</td>
                    <td className="px-2 py-1.5">
                      <span className={`mono border-2 border-ink px-1.5 py-0.5 ${ACTION_STYLE[r.action]}`}>{r.action}</span>
                    </td>
                    <td className="px-2 py-1.5 font-bold">{r.label || <span className="text-dim">—</span>}</td>
                    <td className="px-2 py-1.5">
                      {r.error ? (
                        <span className="text-red">{r.error}</span>
                      ) : r.action === 'unchanged' ? (
                        <span className="text-dim">nothing</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {Object.entries(r.changes).map(([field, [before, after]]) => (
                            <li key={field}>
                              <span className="mono text-muted">{FIELD_LABEL[field] ?? field}:</span>{' '}
                              {r.action === 'update' && <span className="text-muted line-through">{show(before)}</span>}{' '}
                              <span className="font-semibold">{show(after)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-dim">
            <Check size={12} /> Nothing is saved until you press Apply.
          </p>
        </div>
      )}
    </section>
  );
}
