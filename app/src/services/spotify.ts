import axios from 'axios';

const SPOTIFY_AUTH_BASE = 'https://accounts.spotify.com ';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1 ';

class SpotifyService {
private clientId: string;
private redirectUri: string;
private token: string | null = null;

constructor() {
this.clientId = process.env.SPOTIFY_CLIENT_ID || '';
this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback ';
}

getAuthUrl(): string {
const scope = 'user-read-private user-read-email user-modify-playback-state user-read-playback-state';
return ${SPOTIFY_AUTH_BASE}/authorize? +
client_id=${this.clientId} +
&response_type=code +
&redirect_uri=${encodeURIComponent(this.redirectUri)} +
&scope=${encodeURIComponent(scope)};
}

async exchangeCodeForToken(code: string): Promise<string> {
// Implement PKCE token exchange
return 'mock_token';
}

async getDevices(): Promise<any[]> {
if (!this.token) throw new Error('Not authenticated');

const response = await axios.get(`${SPOTIFY_API_BASE}/me/player/devices`, {
headers: { Authorization: `Bearer ${this.token}` }
});
return response.data.devices;
}

async transferPlayback(deviceId: string): Promise<void> {
if (!this.token) throw new Error('Not authenticated');

await axios.put(`${SPOTIFY_API_BASE}/me/player`, {
device_ids: [deviceId],
play: true
}, {
headers: { Authorization: `Bearer ${this.token}` }
});
}

async play(): Promise<void> {
if (!this.token) throw new Error('Not authenticated');
await axios.put(${SPOTIFY_API_BASE}/me/player/play, {}, {
headers: { Authorization: Bearer ${this.token} }
});
}

async pause(): Promise<void> {
if (!this.token) throw new Error('Not authenticated');
await axios.put(${SPOTIFY_API_BASE}/me/player/pause, {}, {
headers: { Authorization: Bearer ${this.token} }
});
}
}

export default new SpotifyService();
