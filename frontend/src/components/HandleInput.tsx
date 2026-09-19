import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useArtists } from '../lib/queries';
import { at, toHandle, typingHandle } from '../lib/format';

export interface HandleRef {
  id: string;
  slug: string;
  name: string;
  handle?: string | null;
}

const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

/**
 * "@handle" picker for credits and show casts. Typing a name ("divine") or a handle
 * ("@vivianakadivine") suggests matching artists by their @handle - which is their
 * Instagram username when known, otherwise @stage_name. Someone new can be created on
 * the spot with @stage_name (editable later in the artist form).
 */
export function HandleInput({
  value = [],
  onChange,
  onPick,
  single = false,
  createAsProducer = false,
  excludeIds = [],
  placeholder = 'Type a name or @handle…',
}: {
  value?: HandleRef[];
  onChange?: (v: HandleRef[]) => void;
  /** Single mode: called with the picked artist, input clears, no chips. */
  onPick?: (v: HandleRef) => void;
  single?: boolean;
  createAsProducer?: boolean;
  excludeIds?: string[];
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState<{ name: string; handle: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = text.trim().replace(/^@/, '');
  const { data } = useArtists({ q, limit: 8 }, q.length > 0);
  const taken = new Set([...excludeIds, ...value.map((v) => v.id)]);
  const results = (data?.items ?? []).filter((a) => !taken.has(a.id));
  // Matches that can't be picked here are still listed (greyed out) so nobody creates a duplicate.
  const unavailable = (data?.items ?? []).filter((a) => taken.has(a.id));
  const typedHandle = toHandle(text);
  const exact = (data?.items ?? []).some((a) => a.handle === typedHandle || a.name.toLowerCase() === q.toLowerCase());
  const canCreate = !!typedHandle && HANDLE_RE.test(typedHandle) && !exact;
  const options = results.length + (canCreate ? 1 : 0);

  // Typing "@some_handle" -> name suggestion "Some Handle"; typing a name keeps it as typed.
  const startCreate = () => {
    const raw = text.trim();
    const name = raw.startsWith('@')
      ? raw.slice(1).replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : raw;
    setCreating({ name, handle: typedHandle });
    setError(null);
  };

  const pick = (a: HandleRef) => {
    if (single) onPick?.(a);
    else onChange?.([...value, a]);
    setText('');
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  };

  const create = async () => {
    if (!creating) return;
    setError(null);
    try {
      const { artist } = await api<{ artist: HandleRef }>('/admin/artists', {
        method: 'POST',
        body: { name: creating.name.trim() || creating.handle, handle: creating.handle, isProducer: createAsProducer },
      });
      qc.invalidateQueries({ queryKey: ['artists'] });
      setCreating(null);
      pick(artist);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create');
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-[46px] flex-wrap items-center gap-1.5 border-2 border-ink bg-surface px-2 py-1.5 focus-within:shadow-hard-saffron">
        {!single &&
          value.map((v) => (
            <span key={v.id} className="mono inline-flex items-center gap-1 bg-ink py-1 pr-1 pl-2 !normal-case text-paper" title={v.name}>
              {at(v)}
              <button
                type="button"
                onClick={() => onChange?.(value.filter((x) => x.id !== v.id))}
                className="p-0.5 hover:text-saffron"
                aria-label={`Remove ${at(v)}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        <input
          ref={inputRef}
          value={text}
          placeholder={value.length && !single ? '' : placeholder}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
            setCreating(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !text && !single && value.length) onChange?.(value.slice(0, -1));
            if (!options) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => (i + 1) % options);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i - 1 + options) % options);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (active < results.length) pick(results[active]);
              else startCreate();
            }
          }}
          className="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-dim"
          aria-label={placeholder}
        />
      </div>

      {open && q && (options > 0 || unavailable.length > 0) && !creating && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto border-2 border-ink bg-surface shadow-hard" role="listbox">
          {results.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(a)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? 'bg-neon' : 'hover:bg-neon'}`}
              >
                <b className="font-mono">{at(a)}</b>
                <span className="truncate text-muted">{a.name}</span>
                {a.instagramUrl && <span className="mono ml-auto !text-[9px] text-muted">IG</span>}
                {a.isProducer && <span className={`mono ${a.instagramUrl ? '' : 'ml-auto'} bg-ink px-1 !text-[9px] text-paper`}>Producer</span>}
              </button>
            </li>
          ))}
          {unavailable.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm text-dim" aria-disabled="true">
              <b className="font-mono">{at(a)}</b>
              <span className="truncate">{a.name}</span>
              <span className="mono ml-auto !text-[9px]">{excludeIds.includes(a.id) ? 'primary artist' : 'already added'}</span>
            </li>
          ))}
          {canCreate && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={startCreate}
                className={`flex w-full items-center gap-2 border-t-2 border-dashed border-ink/30 px-3 py-2 text-left text-sm ${
                  active === results.length ? 'bg-neon' : 'hover:bg-neon'
                }`}
              >
                <Plus size={14} /> Add new {createAsProducer ? 'producer' : 'artist'} <b className="font-mono">@{typedHandle}</b>
              </button>
            </li>
          )}
        </ul>
      )}

      {creating && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-2 border-dashed border-ink bg-paper p-2">
          <label className="min-w-36 flex-1">
            <span className="label !mb-0.5">Stage name</span>
            <input
              autoFocus
              className="input !py-1.5"
              value={creating.name}
              onChange={(e) => setCreating({ name: e.target.value, handle: toHandle(e.target.value) || creating.handle })}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
            />
          </label>
          <label className="min-w-36 flex-1">
            <span className="label !mb-0.5">@handle</span>
            <input
              className="input !py-1.5 font-mono"
              value={'@' + creating.handle}
              onChange={(e) => setCreating({ ...creating, handle: typingHandle(e.target.value) })}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), create())}
            />
          </label>
          <button type="button" className="btn-primary !px-3 !py-2" onClick={create} disabled={!creating.handle}>
            Add
          </button>
          <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => setCreating(null)}>
            Cancel
          </button>
          <p className="w-full text-xs text-dim">Use their Instagram username if you know it; you can change it later in the artist form.</p>
          {error && <p className="w-full text-sm text-red">{error}</p>}
        </div>
      )}
    </div>
  );
}
