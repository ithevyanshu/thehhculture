import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';

/** Change password (current + new + confirm). Also clears an admin reset's "must change" flag. */
export function PasswordForm({ onDone, currentLabel = 'Current password' }: { onDone?: () => void; currentLabel?: string }) {
  const { setUser } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setStatus({ ok: false, msg: "The new passwords don't match" });
    setSaving(true);
    setStatus(null);
    try {
      const { user } = await api<{ user: User }>('/auth/password', {
        method: 'POST',
        body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
      });
      setUser(user);
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setStatus({ ok: true, msg: 'Password changed' });
      onDone?.();
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof ApiError ? err.message : 'Could not change password' });
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof typeof form, label: string, autoComplete: string) => (
    <div>
      <label className="label" htmlFor={key}>
        {label}
      </label>
      <input
        id={key}
        type="password"
        className="input"
        autoComplete={autoComplete}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        required
        minLength={key === 'currentPassword' ? 1 : 8}
        maxLength={128}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      {field('currentPassword', currentLabel, 'current-password')}
      {field('newPassword', 'New password (8+ characters)', 'new-password')}
      {field('confirm', 'New password again', 'new-password')}
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Change password'}
        </button>
        {status && <span className={`text-sm ${status.ok ? 'text-saffron-soft' : 'text-red'}`}>{status.msg}</span>}
      </div>
    </form>
  );
}
