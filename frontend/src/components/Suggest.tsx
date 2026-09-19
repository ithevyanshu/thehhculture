import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import { SUGGESTION_STATUS_LABEL, SUGGESTION_TYPES, type Suggestion, type SuggestionType } from '../lib/types';

interface Prefill {
  type?: SuggestionType;
  message?: string;
  /** Defaults to the current page. Pass null to send without a page. */
  contextUrl?: string | null;
}

const SuggestContext = createContext<{ openSuggest: (prefill?: Prefill) => void } | null>(null);

export function useSuggest() {
  const ctx = useContext(SuggestContext);
  if (!ctx) throw new Error('useSuggest must be used inside <SuggestProvider>');
  return ctx.openSuggest;
}

/** "Feeling something is missing?" - one modal for the whole app, opened from anywhere. */
export function SuggestProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [prefill, setPrefill] = useState<Prefill | null>(null);

  const openSuggest = useCallback(
    (p: Prefill = {}) => setPrefill({ contextUrl: location.pathname + location.search, ...p }),
    [location.pathname, location.search],
  );
  const value = useMemo(() => ({ openSuggest }), [openSuggest]);

  return (
    <SuggestContext.Provider value={value}>
      {children}
      {prefill && <SuggestModal prefill={prefill} onClose={() => setPrefill(null)} />}
    </SuggestContext.Provider>
  );
}

function SuggestModal({ prefill, onClose }: { prefill: Prefill; onClose: () => void }) {
  const { user } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const [type, setType] = useState<SuggestionType>(prefill.type ?? 'MISSING_ARTIST');
  const [message, setMessage] = useState(prefill.message ?? '');
  const [contextUrl, setContextUrl] = useState<string | null>(prefill.contextUrl ?? null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const mine = useQuery({
    queryKey: ['me', 'suggestions'],
    queryFn: () => api<{ items: Suggestion[] }>('/suggestions/mine'),
    enabled: !!user,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    textRef.current?.focus();
    const len = textRef.current?.value.length ?? 0;
    textRef.current?.setSelectionRange(len, len);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      await api('/suggestions', { method: 'POST', body: { type, message, contextUrl } });
      setSent(true);
      qc.invalidateQueries({ queryKey: ['me', 'suggestions'] });
    } catch (err) {
      if (err instanceof ApiError) {
        const detail = err.details ? Object.values(err.details).flat().join(' ') : '';
        setError(detail || err.message);
      } else setError('Could not send. Try again?');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send a suggestion"
        onClick={(e) => e.stopPropagation()}
        className="tape relative max-h-[90vh] w-full max-w-lg overflow-y-auto border-2 border-ink bg-surface p-6 shadow-hard"
      >
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 hover:bg-neon" aria-label="Close">
          <X size={18} />
        </button>
        <p className="marker text-xl text-saffron-soft">feeling something's missing?</p>
        <h2 className="display mt-1 text-4xl">Tell the editors</h2>

        {!user ? (
          <div className="mt-5">
            <p className="text-muted">Log in to send suggestions. That way we can tell you when we act on them.</p>
            <div className="mt-5 flex gap-2">
              <Link to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} onClick={onClose} className="btn-primary">
                Log in
              </Link>
              <Link to="/register" onClick={onClose} className="btn-ghost">
                Create account
              </Link>
            </div>
          </div>
        ) : sent ? (
          <div className="mt-5">
            <p className="display text-2xl">
              <span className="highlight">Got it, thanks!</span>
            </p>
            <p className="mt-2 text-muted">Every suggestion is read by a human. Check back here to see its status.</p>
            <div className="mt-5 flex gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  setSent(false);
                  setMessage('');
                }}
              >
                Send another
              </button>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Type">
              {SUGGESTION_TYPES.map((t) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={type === t.value}
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`chip ${type === t.value ? 'chip-active' : ''}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              ref={textRef}
              className="input min-h-32"
              maxLength={1000}
              required
              minLength={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                type === 'MISSING_ARTIST'
                  ? 'Who should we add? Links to their Spotify/Instagram help.'
                  : type === 'MISSING_SONG'
                    ? 'Which track or album? Artist + title please.'
                    : type === 'CORRECTION'
                      ? "What's wrong, and what should it say?"
                      : 'Tell us your idea…'
              }
            />
            {contextUrl && (
              <p className="mono flex items-center gap-2 text-muted">
                Sent from <span className="truncate text-ink normal-case">{contextUrl}</span>
                <button type="button" onClick={() => setContextUrl(null)} className="hover:text-red" aria-label="Don't attach page">
                  <X size={12} />
                </button>
              </p>
            )}
            {error && <p className="border-2 border-red bg-red/10 px-3 py-2 text-sm text-red">{error}</p>}
            <button className="btn-primary" disabled={sending || message.trim().length < 5}>
              {sending ? 'Sending…' : 'Send suggestion'}
            </button>
          </form>
        )}

        {user && !!mine.data?.items.length && (
          <div className="mt-8 border-t-2 border-dashed border-ink/30 pt-4">
            <p className="label">Your recent suggestions</p>
            <ul className="space-y-2">
              {mine.data.items.slice(0, 5).map((s) => (
                <li key={s.id} className="border border-ink/20 bg-paper p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="line-clamp-2">{s.message}</span>
                    <span className={`mono shrink-0 px-1.5 ${s.status === 'DONE' ? 'bg-neon' : s.status === 'PLANNED' ? 'bg-saffron' : s.status === 'DISMISSED' ? 'bg-surface-3' : 'border border-ink'}`}>
                      {SUGGESTION_STATUS_LABEL[s.status]}
                    </span>
                  </div>
                  {s.adminNote && <p className="marker mt-1 text-saffron-soft">editor: {s.adminNote}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline "something wrong or missing here?" strip for artist / song pages. */
export function MissingHere({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <div className="mb-16 flex flex-col items-start justify-between gap-3 border-2 border-dashed border-ink p-4 sm:flex-row sm:items-center">
      <p className="marker text-lg">{text}</p>
      <button onClick={onClick} className="btn-ghost shrink-0">
        <Lightbulb size={14} /> Tell the editors
      </button>
    </div>
  );
}

/** Sticker-style button fixed to the corner of every page. */
export function FloatingSuggestButton() {
  const openSuggest = useSuggest();
  const location = useLocation();
  if (location.pathname.startsWith('/admin')) return null;
  return (
    <button
      onClick={() => openSuggest()}
      className="group fixed right-4 bottom-4 z-40 flex rotate-2 items-center gap-2 border-2 border-ink bg-neon px-3 py-2 shadow-hard transition hover:rotate-0 hover:-translate-y-0.5"
      aria-label="Something missing? Send a suggestion"
    >
      <Lightbulb size={16} />
      <span className="mono hidden sm:inline">Something missing?</span>
    </button>
  );
}
