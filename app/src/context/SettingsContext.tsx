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

export type AppMode = 'home' | 'camping';

export type Settings = {
  /** URL used in Home mode — mDNS on the local network, no internet needed */
  homeUrl: string;
  /** URL used in Camping mode — Pi's own hotspot, direct connection */
  campingUrl: string;
  /** home = same WiFi as the bridge; camping = connected to bridge's hotspot */
  mode: AppMode;
};

type SettingsContextType = Settings & {
  /** Computed: the active bridge URL for the current mode */
  bridgeUrl: string;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  isLoaded: boolean;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Settings = {
  homeUrl:    'http://campfire-bridge.local:3000',
  campingUrl: 'http://192.168.4.1:3000',
  mode:       'home',
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
          const parsed = JSON.parse(raw) as Partial<Omit<Settings, 'mode'>> & {
            bridgeUrl?: string;
            onlineUrl?: string;
            offlineUrl?: string;
            mode?: string;
          };

          // Migrate: bridgeUrl / onlineUrl → homeUrl
          if (!parsed.homeUrl) {
            parsed.homeUrl = parsed.onlineUrl ?? parsed.bridgeUrl;
          }
          // Migrate: offlineUrl → campingUrl
          if (!parsed.campingUrl && parsed.offlineUrl) {
            parsed.campingUrl = parsed.offlineUrl;
          }
          // Migrate: mode 'online'→'home', 'offline'→'camping'
          if (parsed.mode === 'online')  parsed.mode = 'home';
          if (parsed.mode === 'offline') parsed.mode = 'camping';

          const merged = { ...DEFAULTS, ...parsed } as Settings;
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
      bridgeUrl: settings.mode === 'home' ? settings.homeUrl : settings.campingUrl,
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
