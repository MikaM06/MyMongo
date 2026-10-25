import {type FormEvent, useState} from 'react';
import {ApiError} from '../lib/api';
import {useAuth} from '../lib/auth';
import {LogoMark} from '../components/logo';
import {Button} from '../components/ui/button';
import {Field, Input} from '../components/ui/input';

export function LoginPage() {
  const {login} = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Connexion impossible.',
      );
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[360px] rounded-md border border-line bg-panel">
        <div className="flex items-center gap-2.5 border-b border-line bg-panel-2 px-5 py-3.5">
          <LogoMark className="size-6" />
          <div>
            <h1 className="text-[15px] leading-tight font-semibold">MyMongo</h1>
            <p className="text-xs text-muted">Your MongoDB. Under control.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 p-5">
          <Field label="Identifiant" htmlFor="username">
            <Input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={event => setUsername(event.target.value)}
              spellCheck={false}
              required
            />
          </Field>
          <Field label="Mot de passe" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              required
            />
          </Field>
          {error ? (
            <p
              role="alert"
              className="rounded bg-danger-soft px-3 py-2 text-[13px] text-danger"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="w-full justify-center"
            loading={loading}
            disabled={!username || !password}
          >
            Se connecter
          </Button>
        </form>
        <p className="border-t border-line px-5 py-2.5 text-xs text-faint">
          Les identifiants MongoDB restent sur le serveur.
        </p>
      </div>
    </div>
  );
}
