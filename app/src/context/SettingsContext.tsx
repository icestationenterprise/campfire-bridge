import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppMode = 'online' | 'offline';

export type Settings = {
  /** Base URL of the Raspberry Pi bridge API, e.g. http://192.168.1.42:8080 */
  bridgeUrl: string;
  /** Spotify OAuth client ID registered at developer.spotify.com */
  spotifyClientId: string;
  /**
   * online — Spotify Connect via Pi bridge (requires internet)
   * offline — Party mode: Pi syncs audio across BT speakers, no internet needed
   */
  mode: AppMode;
  /**
   * When true, hides Campfire's transport controls and seek bar so the user
   * controls playback from the Spotify app instead.
   */
  controllerDisabled: boolean;
};

type SettingsContextType = Settings & {
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  isLoaded: boolean;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Settings = {
  bridgeUrl: 'http://localhost:3000',
  spotifyClientId: '',
  mode: 'online',
  controllerDisabled: false,
};

const STORAGE_KEY = '@campfire_settings';

// ── Context ───────────────────────────────────────────────────────────────────

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);
  const settingsRef = useRef(settings);

  // Load persisted settings on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Settings>;
          const merged = { ...DEFAULTS, ...parsed };
          settingsRef.current = merged;
          setSettings(merged);
        }
      })
      .catch(() => {/* use defaults on read error */})
      .finally(() => setIsLoaded(true));
  }, []);

  const setSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      const next = { ...settingsRef.current, [key]: value };
      settingsRef.current = next;
      setSettings(next);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    },
    [],
  );

  const value = useMemo<SettingsContextType>(
    () => ({ ...settings, setSetting, isLoaded }),
    [settings, setSetting, isLoaded],
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within <SettingsProvider>');
  return ctx;
}
