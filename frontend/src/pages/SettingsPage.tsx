import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../lib/api';
import type { User } from '../lib/types';
import { TastePicker } from './TastePicker';

function ProfileForm() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    displayName: user?.displayName ?? '',
    bio: user?.bio ?? '',
    avatarUrl: user?.avatarUrl ?? '',
  });
  const [status, setStatus] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus(null);
    try {
      const { user: updated } = await api<{ user: User }>('/me/profile', { method: 'PATCH', body: form });
      setUser(updated);
      setStatus('Profile saved');
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Could not save');
    }
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div>
        <label className="label" htmlFor="displayName">
          Display name
        </label>
        <input id="displayName" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required maxLength={50} />
      </div>
      <div>
        <label className="label" htmlFor="avatarUrl">
          Avatar URL
        </label>
        <input id="avatarUrl" className="input" type="url" value={form.avatarUrl} onChange={(e) => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://…" />
      </div>
      <div>
        <label className="label" htmlFor="bio">
          Bio
        </label>
        <textarea id="bio" className="input min-h-24" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={300} />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn-primary">Save profile</button>
        {status && <span className="text-sm text-muted">{status}</span>}
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="display mb-2 text-5xl md:text-7xl">Settings</h1>
      <p className="mb-10 text-muted">
        Signed in as <span className="text-bone">{user?.email}</span>
      </p>
      <section className="mb-14">
        <h2 className="display mb-4 text-3xl">Profile</h2>
        <ProfileForm />
      </section>
      <section className="mb-14">
        <p className="mb-6 text-sm text-muted">Your taste shapes the home screen. Follow artists and like songs to tune it even further.</p>
        <TastePicker mode="settings" />
      </section>
    </div>
  );
}
