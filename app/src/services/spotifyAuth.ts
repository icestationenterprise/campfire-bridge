/**
 * spotifyAuth.ts
 *
 * Spotify PKCE OAuth helpers — pure TypeScript, zero native dependencies.
 *
 * Flow:
 *  1. generatePKCE()            → { verifier, challenge }
 *  2. buildAuthorizeURL(...)    → open this URL in Safari / Linking
 *  3. User logs in, Spotify redirects to campfire://spotify-callback?code=...
 *  4. exchangeCode(code, ...)   → { access_token, refresh_token, expires_in }
 *  5. refreshAccessToken(...)   → { access_token, expires_in }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Constants ─────────────────────────────────────────────────────────────────

export const SPOTIFY_REDIRECT_URI = 'campfire://spotify-callback';
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'user-library-read',
  'user-top-read',
].join(' ');

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

const STORAGE_KEYS = {
  accessToken:  '@spotify_access_token',
  refreshToken: '@spotify_refresh_token',
  expiresAt:    '@spotify_expires_at',
  verifier:     '@spotify_pkce_verifier',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpotifyTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms timestamp
};

// ── Pure-JS SHA-256 (no crypto.subtle needed — works on Hermes) ───────────────

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function ror32(v: number, n: number): number {
  return (v >>> n) | (v << (32 - n));
}

function sha256(message: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  const len = message.length;
  const padLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(padLen);
  padded.set(message);
  padded[len] = 0x80;
  // 64-bit big-endian bit length (we only support messages < 2^32 bits)
  const bits = len * 8;
  padded[padLen - 4] = (bits >>> 24) & 0xff;
  padded[padLen - 3] = (bits >>> 16) & 0xff;
  padded[padLen - 2] = (bits >>> 8)  & 0xff;
  padded[padLen - 1] =  bits         & 0xff;

  const W = new Uint32Array(64);
  for (let i = 0; i < padLen; i += 64) {
    const view = new DataView(padded.buffer, i, 64);
    for (let j = 0; j < 16; j++) W[j] = view.getUint32(j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = ror32(W[j - 15], 7)  ^ ror32(W[j - 15], 18) ^ (W[j - 15] >>> 3);
      const s1 = ror32(W[j - 2],  17) ^ ror32(W[j - 2],  19) ^ (W[j - 2]  >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = [H[0], H[1], H[2], H[3], H[4], H[5], H[6], H[7]];
    for (let j = 0; j < 64; j++) {
      const S1   = ror32(e, 6) ^ ror32(e, 11) ^ ror32(e, 25);
      const ch   = (e & f) ^ (~e & g);
      const t1   = (h + S1 + ch + SHA256_K[j] + W[j]) >>> 0;
      const S0   = ror32(a, 2) ^ ror32(a, 13) ^ ror32(a, 22);
      const maj  = (a & b) ^ (a & c) ^ (b & c);
      const t2   = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  H.forEach((word, i) => {
    out[i * 4]     = (word >>> 24) & 0xff;
    out[i * 4 + 1] = (word >>> 16) & 0xff;
    out[i * 4 + 2] = (word >>> 8)  & 0xff;
    out[i * 4 + 3] =  word         & 0xff;
  });
  return out;
}

// ── Base64url helpers (pure JS — no btoa needed, works on all RN engines) ────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    s += B64[a >> 2];
    s += B64[((a & 3) << 4) | (b >> 4)];
    s += B64[((b & 15) << 2) | (c >> 6)];
    s += B64[c & 63];
  }
  // Strip padding characters based on leftover bytes
  const rem = bytes.length % 3;
  if (rem === 1) s = s.slice(0, -2);
  else if (rem === 2) s = s.slice(0, -1);
  // Convert standard base64 → base64url
  return s.replace(/\+/g, '-').replace(/\//g, '_');
}

function stringToBytes(str: string): Uint8Array {
  // Code verifiers are always ASCII so a simple char-code conversion is fine
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

// ── PKCE ─────────────────────────────────────────────────────────────────────

/** Generates a random PKCE code_verifier and its SHA-256 code_challenge. */
export function generatePKCE(): { verifier: string; challenge: string } {
  const random = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(random);
  } else {
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(Math.random() * 256);
  }
  const verifier  = base64url(random);
  const challenge = base64url(sha256(stringToBytes(verifier)));
  return { verifier, challenge };
}

// ── OAuth URL ─────────────────────────────────────────────────────────────────

export function buildAuthorizeURL(
  clientId: string,
  challenge: string,
  state = '',
): string {
  const params = new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          SPOTIFY_REDIRECT_URI,
    scope:                 SPOTIFY_SCOPES,
    code_challenge_method: 'S256',
    code_challenge:        challenge,
  });
  if (state) params.set('state', state);  // omit entirely when empty
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ── Token exchange ────────────────────────────────────────────────────────────

export async function exchangeCode(
  clientId: string,
  code: string,
  verifier: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    code,
    redirect_uri:  SPOTIFY_REDIRECT_URI,
    client_id:     clientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token exchange failed: ${txt}`);
  }
  return res.json() as Promise<SpotifyTokens>;
}

export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
    client_id:     clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Token refresh failed: ${txt}`);
  }
  return res.json() as Promise<SpotifyTokens>;
}

// ── AsyncStorage persistence ──────────────────────────────────────────────────

export async function saveTokens(tokens: SpotifyTokens): Promise<void> {
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  await AsyncStorage.multiSet([
    [STORAGE_KEYS.accessToken,  tokens.access_token],
    [STORAGE_KEYS.refreshToken, tokens.refresh_token],
    [STORAGE_KEYS.expiresAt,    String(expiresAt)],
  ]);
}

export async function loadTokens(): Promise<StoredTokens | null> {
  const pairs = await AsyncStorage.multiGet([
    STORAGE_KEYS.accessToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.expiresAt,
  ]);
  const [at, rt, ea] = pairs.map(p => p[1]);
  if (!at || !rt || !ea) return null;
  return { accessToken: at, refreshToken: rt, expiresAt: Number(ea) };
}

export async function clearTokens(): Promise<void> {
  await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
}

export async function saveVerifier(verifier: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.verifier, verifier);
}

export async function loadVerifier(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.verifier);
}
