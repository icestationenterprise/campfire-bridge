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
  /** URL used in Online mode (Tailscale IP) */
  onlineUrl: string;
  /** URL used in Offline mode (Campfire hotspot) */
  offlineUrl: string;
  /** Spotify OAuth client ID */
  spotifyClientId: string;
  /** online = Spotify Connect via Pi; offline = AirPlay via Pi hotspot */
  mode: AppMode;
  /** Hide Campfire transport controls, use Spotify app instead */
  controllerDisabled: boolean;
};

type SettingsContextType = Settings & {
  /** Computed: the active bridge URL for the current mode */
  bridgeUrl: string;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  isLoaded: boolean;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Settings = {
  onlineUrl:          'http://100.102.229.11:3000',
  offlineUrl:         'http://192.168.4.1:3000',
  spotifyClientId:    '',
  mode:               'online',
  controllerDisabled: false,
};

const STORAGE_KEY = '@campfire_settings';

// ── Context ───────────────────────────────────────────────────────────────────

const SettingsContext = createContext<SettingsContextType | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Settings> & { bridgeUrl?: string };
          // Migrate old single bridgeUrl → onlineUrl
          if (parsed.bridgeUrl && !parsed.onlineUrl) {
            parsed.onlineUrl = parsed.bridgeUrl;
          }
          const merged = { ...DEFAULTS, ...parsed };
          settingsRef.current = merged;
          setSettings(merged);
        }
      })
      .catch(() => {})
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
    () => ({
      ...settings,
      bridgeUrl: settings.mode === 'online' ? settings.onlineUrl : settings.offlineUrl,
      setSetting,
      isLoaded,
    }),
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
