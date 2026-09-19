import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../lib/api';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-5xl items-center gap-10 py-6 md:grid-cols-2 md:py-16">
      <div className="hidden md:block">
        <p className="display text-8xl leading-[0.85]">
          Real <span className="highlight">hip hop.</span>
          <br />
          Real <span className="text-red">gullies.</span>
          <br />
          Your <span className="text-saffron">issue.</span>
        </p>
        <p className="marker mt-6 max-w-sm -rotate-1 text-xl text-muted">
          follow who you rate, save what you replay - we'll print the rest of the scene for you.
        </p>
      </div>
      <div className="tape relative border-2 border-ink bg-surface p-6 shadow-hard md:p-8">
        <h1 className="display text-5xl">{title}</h1>
        <p className="mt-2 mb-6 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function FieldError({ errors, name }: { errors?: Record<string, string[]>; name: string }) {
  const msg = errors?.[name]?.[0];
  return msg ? <p className="mt-1 text-xs text-pink">{msg}</p> : null;
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New here?{' '}
          <Link to={`/register${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="text-saffron hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="identifier">
            Email or username
          </label>
          <input id="identifier" className="input" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="rounded-none bg-pink/10 px-3 py-2 text-sm text-pink">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', username: '', displayName: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>();
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors(undefined);
    try {
      await register({ ...form, displayName: form.displayName || undefined });
      navigate('/onboarding', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.details);
      } else setError('Could not create account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Join the culture"
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-saffron hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input id="email" type="email" className="input" autoComplete="email" value={form.email} onChange={set('email')} required />
          <FieldError errors={fieldErrors} name="email" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="username">
              Username
            </label>
            <input id="username" className="input" autoComplete="username" value={form.username} onChange={set('username')} required minLength={3} maxLength={24} />
            <FieldError errors={fieldErrors} name="username" />
          </div>
          <div>
            <label className="label" htmlFor="displayName">
              Display name
            </label>
            <input id="displayName" className="input" value={form.displayName} onChange={set('displayName')} placeholder="Optional" maxLength={50} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="new-password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={8}
          />
          <FieldError errors={fieldErrors} name="password" />
          <p className="mt-1 text-xs text-dim">At least 8 characters.</p>
        </div>
        {error && !fieldErrors && <p className="rounded-none bg-pink/10 px-3 py-2 text-sm text-pink">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}
