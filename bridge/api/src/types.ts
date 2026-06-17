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

/**
 * Bridge status. Playback itself has no local representation — audio comes
 * from AirPlay (iOS) or Cast (Android) sessions initiated on the phone, and
 * plays independently of this API. `party` reflects whether the campfire_party
 * sink is loaded and which speakers are receiving audio through it; AirPlay
 * is started/stopped together with party mode (see /api/party/enable|disable).
 */
export type BridgeStatus = {
  device: string;
  party: PartyStatus;
  network_mode: 'home' | 'camping';
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
