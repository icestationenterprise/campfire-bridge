export const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080 ';
export const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
export const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback ';

export const BLUETOOTH_DEVICE_TYPES = {
SPEAKER: 'speaker',
HEADPHONES: 'headphones',
CAR: 'car',
OTHER: 'other'
};

export const PLAYBACK_STATES = {
PLAYING: 'playing',
PAUSED: 'paused',
STOPPED: 'stopped'
};
