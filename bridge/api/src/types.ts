export interface Device {
id: string;
name: string;
type: string;
is_active: boolean;
}

export interface Track {
id: string;
name: string;
artists: string[];
album: string;
duration_ms: number;
}

export interface PlaybackState {
is_playing: boolean;
progress_ms: number;
device: Device;
track: Track;
}
