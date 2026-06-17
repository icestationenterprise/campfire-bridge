import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Bridge status. Playback itself has no local representation — audio comes
 * from AirPlay (iOS) or Cast (Android) sessions initiated on the phone, and
 * plays independently of this API. `party` reflects whether the campfire_party
 * sink is loaded and which speakers are receiving audio through it; enabling
 * party mode also starts AirPlay (see enableParty/disableParty below).
 */
export type BridgeStatus = {
  device: string;
  party: PartyStatus;
  network_mode?: 'home' | 'camping';
};

export type BluetoothDevice = {
  mac: string;
  name: string;
  connected: boolean;
};

export type DiscoveredDevice = {
  mac: string;
  name: string;
  paired: boolean;
};

export type SpeakerState = {
  mac: string;
  volume: number;
  muted: boolean;
  calibration_ms?: number;
};

export type PartyStatus = {
  active: boolean;
  speakers: SpeakerState[];
};

export type BridgeContextType = {
  status: BridgeStatus | null;
  btDevices: BluetoothDevice[];
  discoveredDevices: DiscoveredDevice[];
  scanning: boolean;
  isReachable: boolean;
  networkMode: 'home' | 'camping' | null;
  baseURL: string;
  refresh: () => Promise<void>;
  // Bluetooth device management
  fetchBtDevices:     () => Promise<void>;
  connectBtDevice:    (mac: string) => Promise<void>;
  disconnectBtDevice: (mac: string) => Promise<void>;
  scanBtDevices:      () => Promise<void>;
  pairBtDevice:       (mac: string) => Promise<void>;
  removeBtDevice:     (mac: string) => Promise<void>;
  // Party mode + AirPlay (enabling party mode starts AirPlay; the bridge
  // appears as an AirPlay target as soon as at least one speaker is added)
  partyStatus:     PartyStatus;
  enableParty:     (macs: string[]) => Promise<void>;
  disableParty:    () => Promise<void>;
  setSpeakerVolume:    (mac: string, volume: number) => Promise<void>;
  setSpeakerMuted:     (mac: string, muted: boolean) => Promise<void>;
  setGroupVolume:      (volume: number) => Promise<void>;
  shiftGroupVolume:    (delta: number) => Promise<void>;
  setGroupMuted:       (muted: boolean) => Promise<void>;
  adjustSpeakerSync:   (mac: string, deltaMs: number) => Promise<void>;
};

// ── Context ───────────────────────────────────────────────────────────────────

const BridgeContext = createContext<BridgeContextType | null>(null);

type BridgeProviderProps = {
  baseURL?: string;
  /** Alternate URL to try after 3 consecutive primary failures. */
  fallbackUrl?: string;
  /** Called when the fallback URL successfully responds — use to persist the mode switch. */
  onFallback?: () => void;
  children: React.ReactNode;
};

export default function BridgeProvider({
  baseURL = 'http://localhost:3000',
  fallbackUrl,
  onFallback,
  children,
}: BridgeProviderProps) {
  const [status,      setStatus]      = useState<BridgeStatus | null>(null);
  const [btDevices,   setBtDevices]   = useState<BluetoothDevice[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [isReachable, setReachable]   = useState(false);
  const [networkMode, setNetworkMode] = useState<'home' | 'camping' | null>(null);
  const [partyStatus, setPartyStatus] = useState<PartyStatus>({ active: false, speakers: [] });
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const failCount      = useRef(0);
  const tryingFallback = useRef(false);

  // ── Core fetch ────────────────────────────────────────────────────────────

  const request = useCallback(
    async (path: string, init?: RequestInit): Promise<unknown> => {
      const res = await fetch(`${baseURL}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Bridge ${path} → ${res.status}: ${body}`);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    },
    [baseURL],
  );

  // ── Status polling with auto-fallback ────────────────────────────────────
  // After 3 consecutive primary-URL failures, tries fallbackUrl once.
  // If fallback succeeds, calls onFallback() to persist the mode switch.
  // Resets on any success or when baseURL changes (manual mode switch).

  const fetchStatus = useCallback(async (url: string): Promise<BridgeStatus> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${url}/api/status`, {
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json() as Promise<BridgeStatus>;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Reset fallback state whenever the primary URL changes (user toggled mode manually).
  useEffect(() => {
    failCount.current      = 0;
    tryingFallback.current = false;
  }, [baseURL]);

  const refresh = useCallback(async () => {
    const url = tryingFallback.current && fallbackUrl ? fallbackUrl : baseURL;
    try {
      const s = await fetchStatus(url);
      if (tryingFallback.current) {
        tryingFallback.current = false;
        onFallback?.();
      }
      failCount.current = 0;
      setStatus(s);
      setReachable(true);
      if (s.party) setPartyStatus(s.party);
      if (s.network_mode) setNetworkMode(s.network_mode);
    } catch {
      if (tryingFallback.current) {
        // Fallback also failed — reset and retry primary next cycle.
        tryingFallback.current = false;
        failCount.current      = 0;
      } else {
        failCount.current += 1;
        if (failCount.current >= 3 && fallbackUrl && fallbackUrl !== baseURL) {
          tryingFallback.current = true;
        }
      }
      setReachable(false);
    }
  }, [baseURL, fallbackUrl, onFallback, fetchStatus]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  // ── Bluetooth device management ───────────────────────────────────────────

  const fetchBtDevices = useCallback(async () => {
    const data = (await request('/api/bt/devices')) as { devices: BluetoothDevice[] };
    setBtDevices(data.devices ?? []);
  }, [request]);

  const connectBtDevice = useCallback(async (mac: string) => {
    await request('/api/bt/connect', { method: 'POST', body: JSON.stringify({ mac }) });
    await fetchBtDevices();
    await refresh(); // party status may have changed (auto-add)
  }, [request, fetchBtDevices, refresh]);

  const disconnectBtDevice = useCallback(async (mac: string) => {
    await request('/api/bt/disconnect', { method: 'POST', body: JSON.stringify({ mac }) });
    await fetchBtDevices();
  }, [request, fetchBtDevices]);

  const scanBtDevices = useCallback(async () => {
    setScanning(true);
    try {
      const data = (await request('/api/bt/scan', { method: 'POST' })) as {
        devices: DiscoveredDevice[];
      };
      setDiscoveredDevices(data.devices ?? []);
    } finally {
      setScanning(false);
    }
  }, [request]);

  const pairBtDevice = useCallback(async (mac: string) => {
    await request('/api/bt/pair', { method: 'POST', body: JSON.stringify({ mac }) });
    await fetchBtDevices();
    setDiscoveredDevices(prev =>
      prev.map(d => d.mac === mac ? { ...d, paired: true } : d),
    );
  }, [request, fetchBtDevices]);

  const removeBtDevice = useCallback(async (mac: string) => {
    await request(`/api/bt/devices/${mac}`, { method: 'DELETE' });
    await fetchBtDevices();
    setDiscoveredDevices(prev => prev.filter(d => d.mac !== mac));
  }, [request, fetchBtDevices]);

  // ── Party mode + AirPlay ───────────────────────────────────────────────────

  const enableParty = useCallback(async (macs: string[]) => {
    const data = (await request('/api/party/enable', {
      method: 'POST',
      body: JSON.stringify({ macs }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const disableParty = useCallback(async () => {
    const data = (await request('/api/party/disable', { method: 'POST' })) as {
      party: PartyStatus;
    };
    setPartyStatus(data.party);
  }, [request]);

  const setSpeakerVolume = useCallback(async (mac: string, volume: number) => {
    const data = (await request('/api/party/speaker/volume', {
      method: 'POST',
      body: JSON.stringify({ mac, volume }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const setSpeakerMuted = useCallback(async (mac: string, muted: boolean) => {
    const data = (await request('/api/party/speaker/mute', {
      method: 'POST',
      body: JSON.stringify({ mac, muted }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const setGroupVolume = useCallback(async (volume: number) => {
    const data = (await request('/api/party/volume', {
      method: 'POST',
      body: JSON.stringify({ volume }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const shiftGroupVolume = useCallback(async (delta: number) => {
    const data = (await request('/api/party/volume/shift', {
      method: 'POST',
      body: JSON.stringify({ delta }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const setGroupMuted = useCallback(async (muted: boolean) => {
    const data = (await request('/api/party/mute', {
      method: 'POST',
      body: JSON.stringify({ muted }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  const adjustSpeakerSync = useCallback(async (mac: string, deltaMs: number) => {
    const data = (await request('/api/party/speaker/sync', {
      method: 'POST',
      body: JSON.stringify({ mac, delta_ms: deltaMs }),
    })) as { party: PartyStatus };
    setPartyStatus(data.party);
  }, [request]);

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo<BridgeContextType>(
    () => ({
      status, btDevices, discoveredDevices, scanning, isReachable, networkMode, baseURL, refresh,
      fetchBtDevices, connectBtDevice, disconnectBtDevice, scanBtDevices, pairBtDevice, removeBtDevice,
      partyStatus, enableParty, disableParty, setSpeakerVolume, setSpeakerMuted, setGroupVolume, shiftGroupVolume, setGroupMuted,
      adjustSpeakerSync,
    }),
    [
      status, btDevices, discoveredDevices, scanning, isReachable, networkMode, baseURL, refresh,
      fetchBtDevices, connectBtDevice, disconnectBtDevice, scanBtDevices, pairBtDevice, removeBtDevice,
      partyStatus, enableParty, disableParty, setSpeakerVolume, setSpeakerMuted, setGroupVolume, shiftGroupVolume, setGroupMuted,
      adjustSpeakerSync,
    ],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge(): BridgeContextType {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within <BridgeProvider>');
  return ctx;
}
