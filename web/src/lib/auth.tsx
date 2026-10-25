import {useQueryClient} from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {api, ApiError, onUnauthorized, setCsrfToken} from './api';

export type Role = 'admin' | 'readonly';

export type Avatar =
  | {kind: 'generated'; seed: string}
  | {kind: 'custom'; format: 'png' | 'jpeg' | 'webp'; version: number};

export interface User {
  username: string;
  role: Role;
  avatar: Avatar;
}

interface SessionPayload {
  user: User;
  csrfToken: string;
}

interface AuthValue {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setAvatar: (avatar: Avatar) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({children}: {children: ReactNode}) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api<SessionPayload>('GET', '/auth/me')
      .then(payload => {
        if (active) {
          setCsrfToken(payload.csrfToken);
          setUser(payload.user);
        }
      })
      .catch((error: unknown) => {
        if (active && !(error instanceof ApiError && error.status === 401)) {
          setUser(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  const login = useCallback(async (username: string, password: string) => {
    const payload = await api<SessionPayload>('POST', '/auth/login', {
      username,
      password,
    });
    setCsrfToken(payload.csrfToken);
    setUser(payload.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('POST', '/auth/logout');
    } finally {
      setCsrfToken('');
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const setAvatar = useCallback(
    (avatar: Avatar) =>
      setUser(current => (current ? {...current, avatar} : current)),
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin: user?.role === 'admin',
        login,
        logout,
        setAvatar,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('AuthProvider manquant');
  }
  return value;
}
