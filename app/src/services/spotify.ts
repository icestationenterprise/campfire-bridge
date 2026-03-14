import axios from 'axios';

const SPOTIFY_API = 'https://api.spotify.com/v1';

/** Build the Spotify authorize URL (PKCE not implemented; this is a simple dev helper). */
export function buildSpotifyAuthorizeURL(options: {
  clientId: string;
  redirectURI: string;
  scope?: string;
  state?: string;
}) {
  const { clientId, redirectURI, scope = 'user-read-playback-state user-modify-playback-state', state = '' } = options;
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectURI,
    scope,
    state
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function play(accessToken: string, body: { uris?: string[]; context_uri?: string; position_ms?: number; device_id?: string } = {}) {
  await axios.put(`${SPOTIFY_API}/me/player/play`, body, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function pause(accessToken: string) {
  await axios.put(`${SPOTIFY_API}/me/player/pause`, {}, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function setVolume(accessToken: string, volumePercent: number) {
  const params = new URLSearchParams({ volume_percent: String(volumePercent) });
  await axios.put(`${SPOTIFY_API}/me/player/volume?${params.toString()}`, {}, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
