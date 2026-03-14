export type Track = {
  title: string;
  artist: string;
  album?: string;
  art_url?: string;
  position_ms: number;
  duration_ms: number;
};

export type BridgeStatus = {
  device: string;
  connected: boolean;
  playing: boolean;
  track: Track;
  volume: number; // 0–100
};

export type BluetoothDevice = {
  mac: string;
  name: string;
  connected: boolean;
};
