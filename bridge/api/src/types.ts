export type Track = {
  title: string;
  artist: string;
  album?: string;
  art_url?: string;
  position_ms: number;
  duration_ms: number;
};

/** Per-speaker state tracked while party mode is active. */
export type SpeakerState = {
  mac: string;
  volume: number;       // 0–100
  muted: boolean;
  calibration_ms?: number; // current loopback buffer (ms) — shown in app UI, populated by getPartyStatus()
};

export type PartyStatus = {
  active: boolean;
  speakers: SpeakerState[];
};

export type BridgeStatus = {
  device: string;
  connected: boolean;
  playing: boolean;
  track: Track;
  volume: number; // 0–100
  party: PartyStatus;
  offline: boolean; // true when AirPlay (shairport-sync) is active
};

export type BluetoothDevice = {
  mac: string;
  name: string;
  connected: boolean;
};

/** A device discovered by a BT scan — may or may not be paired yet. */
export type DiscoveredDevice = {
  mac: string;
  name: string;
  paired: boolean;
};
