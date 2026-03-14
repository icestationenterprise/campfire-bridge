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
  position_ms: number;
  duration_ms: number;
};

export type BridgeStatus = {
  device: string;
  connected: boolean;
  playing: boolean;
  track: BridgeTrack;
  volume: number; // 0..100
};

export type BluetoothDevice = {
  mac: string;
  name: string;
  connected: boolean;
};

export type BridgeContextType = {
  status: BridgeStatus | null;
  btDevices: BluetoothDevice[];
  isReachable: boolean;
  baseURL: string;
  // Playback
  play:    () => Promise<void>;
  pause:   () => Promise<void>;
  next:    () => Promise<void>;
  prev:    () => Promise<void>;
  seek:    (position_ms: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  // Bridge connection
  connect:    () => Promise<void>;
  disconnect: () => Promise<void>;
  refresh:    () => Promise<void>;
  // Bluetooth
  fetchBtDevices:      () => Promise<void>;
  connectBtDevice:     (mac: string) => Promise<void>;
  disconnectBtDevice:  (mac: string) => Promise<void>;
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
  const [status, setStatus]       = useState<BridgeStatus | null>(null);
  const [btDevices, setBtDevices] = useState<BluetoothDevice[]>([]);
  const [isReachable, setReachable] = useState(false);
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
    } catch {
      setReachable(false);
    }
  }, [request]);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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

  const seek = useCallback(
    async (position_ms: number) => {
      await request('/api/seek', {
        method: 'POST',
        body: JSON.stringify({ position_ms }),
      });
      await refresh();
    },
    [request, refresh],
  );

  const setVolume = useCallback(
    async (volume: number) => {
      await request('/api/volume', {
        method: 'POST',
        body: JSON.stringify({ volume }),
      });
      await refresh();
    },
    [request, refresh],
  );

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

  const connectBtDevice = useCallback(
    async (mac: string) => {
      await request('/api/bt/connect', { method: 'POST', body: JSON.stringify({ mac }) });
      await fetchBtDevices();
    },
    [request, fetchBtDevices],
  );

  const disconnectBtDevice = useCallback(
    async (mac: string) => {
      await request('/api/bt/disconnect', { method: 'POST', body: JSON.stringify({ mac }) });
      await fetchBtDevices();
    },
    [request, fetchBtDevices],
  );

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo<BridgeContextType>(
    () => ({
      status,
      btDevices,
      isReachable,
      baseURL,
      play,
      pause,
      next,
      prev,
      seek,
      setVolume,
      connect,
      disconnect,
      refresh,
      fetchBtDevices,
      connectBtDevice,
      disconnectBtDevice,
    }),
    [
      status, btDevices, isReachable, baseURL,
      play, pause, next, prev, seek, setVolume,
      connect, disconnect, refresh,
      fetchBtDevices, connectBtDevice, disconnectBtDevice,
    ],
  );

  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useBridge(): BridgeContextType {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useBridge must be used within <BridgeProvider>');
  return ctx;
}
