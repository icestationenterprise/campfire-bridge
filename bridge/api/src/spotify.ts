import axios from 'axios';

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1 ';

export async function getDevices(token: string) {
const response = await axios.get(${SPOTIFY_API_BASE}/me/player/devices, {
headers: { Authorization: Bearer ${token} }
});
return response.data;
}

export async function transferPlayback(token: string, deviceId: string) {
await axios.put(${SPOTIFY_API_BASE}/me/player, {
device_ids: [deviceId],
play: true
}, {
headers: { Authorization: Bearer ${token} }
});
}

export async function play(token: string) {
await axios.put(${SPOTIFY_API_BASE}/me/player/play, {}, {
headers: { Authorization: Bearer ${token} }
});
}

export async function pause(token: string) {
await axios.put(${SPOTIFY_API_BASE}/me/player/pause, {}, {
headers: { Authorization: Bearer ${token} }
});
}
