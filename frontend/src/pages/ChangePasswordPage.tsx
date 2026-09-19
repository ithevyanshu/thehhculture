import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { PasswordForm } from '../components/PasswordForm';

/** Forced after an admin password reset: nothing else opens until a new password is set. */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-xl">
      <span className="sticker flex w-fit items-center gap-1 !bg-saffron">
        <KeyRound size={14} /> Password reset
      </span>
      <h1 className="display mt-3 text-5xl md:text-6xl">Choose a new password</h1>
      <p className="mt-3 mb-8 text-muted">An admin reset your password. Enter the temporary one they gave you, then pick your own.</p>
      <PasswordForm currentLabel="Temporary password" onDone={() => navigate('/', { replace: true })} />
    </div>
  );
}
