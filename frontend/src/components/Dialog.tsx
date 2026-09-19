import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * In-app replacement for window.confirm / window.alert. Native dialogs are blocked in
 * embedded browsers and can be suppressed by users ("prevent this page from creating
 * dialogs"), which silently turns every confirm() into `false`.
 */
interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  /** Red confirm button for destructive actions (default true). */
  danger?: boolean;
}

interface DialogApi {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  alert: (message: string, title?: string) => Promise<void>;
}

interface Pending {
  kind: 'confirm' | 'alert';
  message: string;
  options: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used inside <DialogProvider>');
  return ctx;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}) =>
      new Promise<boolean>((resolve) => setPending({ kind: 'confirm', message, options, resolve })),
    [],
  );
  const alert = useCallback(
    (message: string, title?: string) =>
      new Promise<void>((resolve) => setPending({ kind: 'alert', message, options: { title, danger: false }, resolve: () => resolve() })),
    [],
  );
  const api = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && <DialogBox pending={pending} onClose={close} />}
    </DialogContext.Provider>
  );
}

function DialogBox({ pending, onClose }: { pending: Pending; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { kind, message, options } = pending;
  const danger = kind === 'confirm' && options.danger !== false;

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm" onClick={() => onClose(false)}>
      <div
        role={kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dhh-dialog-title"
        aria-describedby="dhh-dialog-message"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-ink bg-surface p-6 shadow-hard"
      >
        <h2 id="dhh-dialog-title" className="display text-3xl">
          {options.title ?? (kind === 'confirm' ? 'Are you sure?' : 'Heads up')}
        </h2>
        <p id="dhh-dialog-message" className="mt-3 whitespace-pre-line">
          {message}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          {kind === 'confirm' && (
            <button className="btn-ghost" onClick={() => onClose(false)}>
              Cancel
            </button>
          )}
          <button
            ref={confirmRef}
            className={danger ? 'btn border-ink bg-red text-paper' : 'btn-primary'}
            onClick={() => onClose(true)}
          >
            {kind === 'alert' ? 'OK' : (options.confirmLabel ?? (danger ? 'Delete' : 'Confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}
