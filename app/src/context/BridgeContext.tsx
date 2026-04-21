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

export type BridgeTrack = {
  title: string;
  artist: string;
  art_url?: string;
  position_ms: number;
  duration_ms: number;
};

export type BridgeStatus = {
  device: string;
  connected: boolean;
  playing: boolean;
  track: BridgeTrack;
  volume: number;
  party: PartyStatus;
  offline: boolean;
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
  baseURL: string;
  // Playback
  play:      () => Promise<void>;
  pause:     () => Promise<void>;
  next:      () => Promise<void>;
  prev:      () => Promise<void>;
  seek:      (position_ms: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  // Bridge connection
  connect:    () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh:    () => Promise<void>;
  // Bluetooth device management
  fetchBtDevices:     () => Promise<void>;
  connectBtDevice:    (mac: string) => Promise<void>;
  disconnectBtDevice: (mac: string) => Promise<void>;
  scanBtDevices:      () => Promise<void>;
  pairBtDevice:       (mac: string) => Promise<void>;
  // Party mode
  partyStatus:     PartyStatus;
  enableParty:     (macs: string[]) => Promise<void>;
  disableParty:    () => Promise<void>;
  setSpeakerVolume:    (mac: string, volume: number) => Promise<void>;
  setSpeakerMuted:     (mac: string, muted: boolean) => Promise<void>;
  setGroupVolume:      (volume: number) => Promise<void>;
  adjustSpeakerSync:   (mac: string, deltaMs: number) => Promise<void>;
  // Offline party mode (AirPlay)
  offlineActive:       boolean;
  enableOfflineParty:  (macs: string[]) => Promise<void>;
  disableOfflineParty: () => Promise<void>;
};

// ── Context ───────────────────────────────────────────────────────────────────

const BridgeContext = createContext<BridgeContextType | null>(null);

type BridgeProviderProps = {
  baseURL?: string;
  children: React.ReactNode;
};

export default function BridgeProvider({
  baseURL = 'http://localhost:3000',
  children,
}: BridgeProviderProps) {
  const [status,    setStatus]    = useState<BridgeStatus | null>(null);
  const [btDevices, setBtDevices] = useState<BluetoothDevice[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning,  setScanning]  = useState(false);
  const [isReachable, setReachable] = useState(false);
  const [partyStatus, setPartyStatus] = useState<PartyStatus>({ active: false, speakers: [] });
  const [offlineActive, setOfflineActive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // ── Status polling ────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const s = (await request('/api/status')) as BridgeStatus;
      setStatus(s);
      setReachable(true);
      if (s.party) setPartyStatus(s.party);
      setOfflineActive(s.offline ?? false);
    } catch {
      setReachable(false);
    }
  }, [request]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  // ── Playback commands ─────────────────────────────────────────────────────

  const play = useCallback(async () => {
    await request('/api/play', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

  const pause = useCallback(async () => {
    await request('/api/pause', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

  const next = useCallback(async () => {
    await request('/api/next', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

  const prev = useCallback(async () => {
    await request('/api/previous', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

  const seek = useCallback(async (position_ms: number) => {
    await request('/api/seek', { method: 'POST', body: JSON.stringify({ position_ms }) });
    await refresh();
  }, [request, refresh]);

  const setVolume = useCallback(async (volume: number) => {
    await request('/api/volume', { method: 'POST', body: JSON.stringify({ volume }) });
    await refresh();
  }, [request, refresh]);

  // ── Bridge connect / disconnect ───────────────────────────────────────────

  const connect = useCallback(async () => {
    await request('/api/connect', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

  const disconnect = useCallback(async () => {
    await request('/api/disconnect', { method: 'POST' });
    await refresh();
  }, [request, refresh]);

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
    // After pairing, refresh the paired device list and mark device as paired
    await fetchBtDevices();
    setDiscoveredDevices(prev =>
      prev.map(d => d.mac === mac ? { ...d, paired: true } : d),
    );
  }, [request, fetchBtDevices]);

  // ── Party mode ────────────────────────────────────────────────────────────

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

  const enableOfflineParty = useCallback(async (macs: string[]) => {
    const data = (await request('/api/offline/enable', {
      method: 'POST',
      body: JSON.stringify({ macs }),
    })) as { party: PartyStatus; offline: boolean };
    setPartyStatus(data.party);
    setOfflineActive(data.offline);
  }, [request]);

  const disableOfflineParty = useCallback(async () => {
    const data = (await request('/api/offline/disable', { method: 'POST' })) as {
      party: PartyStatus;
      offline: boolean;
    };
    setPartyStatus(data.party);
    setOfflineActive(data.offline);
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
      status, btDevices, discoveredDevices, scanning, isReachable, baseURL,
      play, pause, next, prev, seek, setVolume,
      connect, disconnect, refresh,
      fetchBtDevices, connectBtDevice, disconnectBtDevice, scanBtDevices, pairBtDevice,
      partyStatus, enableParty, disableParty, setSpeakerVolume, setSpeakerMuted, setGroupVolume,
      adjustSpeakerSync,
      offlineActive, enableOfflineParty, disableOfflineParty,
    }),
    [
      status, btDevices, discoveredDevices, scanning, isReachable, baseURL,
      play, pause, next, prev, seek, setVolume,
      connect, disconnect, refresh,
      fetchBtDevices, connectBtDevice, disconnectBtDevice, scanBtDevices, pairBtDevice,
      partyStatus, enableParty, disableParty, setSpeakerVolume, setSpeakerMuted, setGroupVolume,
      adjustSpeakerSync,
      offlineActive, enableOfflineParty, disableOfflineParty,
    ],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge(): BridgeContextType {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within <BridgeProvider>');
  return ctx;
}
