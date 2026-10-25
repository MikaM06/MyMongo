import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react';

type Theme = 'dark' | 'light';

interface ThemeValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function persistTheme(theme: Theme): void {
  try {
    localStorage.setItem('mymongo.theme', theme);
  } catch {
    return;
  }
}

export function ThemeProvider({children}: {children: ReactNode}) {
  const [theme, setState] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
  const setTheme = useCallback((next: Theme) => {
    document.documentElement.classList.toggle('dark', next === 'dark');
    persistTheme(next);
    setState(next);
  }, []);
  const toggle = useCallback(
    () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    [theme, setTheme],
  );
  return (
    <ThemeContext.Provider value={{theme, toggle, setTheme}}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('ThemeProvider manquant');
  }
  return value;
}
