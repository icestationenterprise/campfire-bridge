import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Linking } from 'react-native';
import {
  buildAuthorizeURL,
  clearTokens,
  exchangeCode,
  generatePKCE,
  loadTokens,
  loadVerifier,
  refreshAccessToken,
  saveTokens,
  saveVerifier,
  SPOTIFY_REDIRECT_URI,
} from '../services/spotifyAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SpotifyDevice = {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number;
};

export type SpotifyTrack = {
  id: string;
  name: string;
  artists: { name: string }[];
  duration_ms: number;
  album: { name: string; images: { url: string }[] };
};

export type SpotifySearchResult = {
  tracks: { items: SpotifyTrack[] };
};

type SpotifyContextType = {
  isAuthenticated: boolean;
  accessToken: string | null;
  /** Kick off the PKCE OAuth flow — opens Spotify in Safari */
  login: (clientId: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Search for tracks on Spotify */
  search: (query: string) => Promise<SpotifyTrack[]>;
  /** List available Spotify Connect devices */
  getDevices: () => Promise<SpotifyDevice[]>;
  /** Transfer playback to a specific device */
  transferPlayback: (deviceId: string, play?: boolean) => Promise<void>;
  /** Play a specific track by URI */
  playTrack: (uri: string, deviceId?: string) => Promise<void>;
};

// ── Context ───────────────────────────────────────────────────────────────────

const SpotifyContext = createContext<SpotifyContextType | null>(null);

const API = 'https://api.spotify.com/v1';

export function SpotifyProvider({
  clientId,
  children,
}: {
  clientId: string;
  children: React.ReactNode;
}) {
  const [accessToken, setAccessToken]   = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt]       = useState<number>(0);
  const refreshTimer                    = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load persisted tokens on mount ────────────────────────────────────────

  useEffect(() => {
    loadTokens().then(stored => {
      if (!stored) return;
      if (Date.now() < stored.expiresAt - 60_000) {
        // Token still valid
        setAccessToken(stored.accessToken);
        setRefreshToken(stored.refreshToken);
        setExpiresAt(stored.expiresAt);
      } else if (stored.refreshToken && clientId) {
        // Token expired — try to refresh immediately
        refreshAccessToken(clientId, stored.refreshToken)
          .then(t => applyTokens(t))
          .catch(() => clearAll());
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Proactive token refresh ───────────────────────────────────────────────

  useEffect(() => {
    if (!refreshToken || !clientId || !expiresAt) return;
    const delay = expiresAt - Date.now() - 60_000; // 1 min before expiry
    if (delay <= 0) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const t = await refreshAccessToken(clientId, refreshToken);
        applyTokens(t);
      } catch {
        clearAll();
      }
    }, delay);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [refreshToken, clientId, expiresAt]);

  // ── Deep-link handler for OAuth callback ─────────────────────────────────

  useEffect(() => {
    const handleUrl = async (url: string) => {
      console.log('[Spotify] handleUrl called:', url);
      if (!url.startsWith(SPOTIFY_REDIRECT_URI)) {
        console.log('[Spotify] URL does not match redirect URI, ignoring');
        return;
      }
      const qIndex = url.indexOf('?');
      if (qIndex === -1) { console.log('[Spotify] No query string'); return; }
      // URLSearchParams.get is not implemented on Hermes — parse manually
      let code: string | null = null;
      for (const pair of url.slice(qIndex + 1).split('&')) {
        const eq = pair.indexOf('=');
        if (eq !== -1 && pair.slice(0, eq) === 'code') {
          code = decodeURIComponent(pair.slice(eq + 1));
          break;
        }
      }
      console.log('[Spotify] code:', code ? code.slice(0, 12) + '…' : 'null', 'clientId:', clientId);
      if (!code || !clientId) return;

      const verifier = await loadVerifier();
      console.log('[Spotify] verifier loaded:', verifier ? verifier.slice(0, 8) + '…' : 'null');
      if (!verifier) return;

      try {
        console.log('[Spotify] Exchanging code for tokens…');
        const tokens = await exchangeCode(clientId, code, verifier);
        console.log('[Spotify] Token exchange succeeded, expires_in:', tokens.expires_in);
        await applyTokens(tokens);
        console.log('[Spotify] applyTokens done — isAuthenticated should be true');
      } catch (e) {
        console.warn('[Spotify] Token exchange failed:', e);
      }
    };

    // Handle the URL that opened the app (cold start)
    Linking.getInitialURL().then(url => { if (url) handleUrl(url); });

    // Handle URL while app is already running
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function applyTokens(t: { access_token: string; refresh_token: string; expires_in: number }) {
    const ea = Date.now() + t.expires_in * 1000;
    setAccessToken(t.access_token);
    setRefreshToken(t.refresh_token);
    setExpiresAt(ea);
    await saveTokens(t);
  }

  async function clearAll() {
    setAccessToken(null);
    setRefreshToken(null);
    setExpiresAt(0);
    await clearTokens();
  }

  /** Make an authenticated Spotify API request, auto-refreshing if needed. */
  const spotifyFetch = useCallback(
    async (path: string, init?: RequestInit): Promise<Response> => {
      if (!accessToken) throw new Error('Not authenticated');
      const res = await fetch(`${API}${path}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
      });
      if (res.status === 401 && refreshToken && clientId) {
        // Token expired mid-session — refresh and retry once
        const t = await refreshAccessToken(clientId, refreshToken);
        await applyTokens(t);
        return fetch(`${API}${path}`, {
          ...init,
          headers: {
            'Authorization': `Bearer ${t.access_token}`,
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
          },
        });
      }
      return res;
    },
    [accessToken, refreshToken, clientId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Public API ────────────────────────────────────────────────────────────

  const login = useCallback(async (id: string) => {
    console.log('[Spotify] login() called with clientId:', id);
    const { verifier, challenge } = generatePKCE();
    console.log('[Spotify] PKCE verifier length:', verifier.length, 'challenge length:', challenge.length);
    console.log('[Spotify] challenge:', challenge);
    await saveVerifier(verifier);
    const url = buildAuthorizeURL(id, challenge);
    console.log('[Spotify] Opening URL:', url);
    await Linking.openURL(url);
  }, []);

  const logout = useCallback(async () => {
    await clearAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(
    async (query: string): Promise<SpotifyTrack[]> => {
      const params = new URLSearchParams({ q: query, type: 'track', limit: '20' });
      const res = await spotifyFetch(`/search?${params.toString()}`);
      if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
      const data = (await res.json()) as SpotifySearchResult;
      return data.tracks.items;
    },
    [spotifyFetch],
  );

  const getDevices = useCallback(async (): Promise<SpotifyDevice[]> => {
    const res = await spotifyFetch('/me/player/devices');
    if (!res.ok) throw new Error(`getDevices failed: ${res.status}`);
    const data = await res.json() as { devices: SpotifyDevice[] };
    return data.devices;
  }, [spotifyFetch]);

  const transferPlayback = useCallback(
    async (deviceId: string, play = true): Promise<void> => {
      const res = await spotifyFetch('/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [deviceId], play }),
      });
      if (!res.ok && res.status !== 204) throw new Error(`transferPlayback failed: ${res.status}`);
    },
    [spotifyFetch],
  );

  const playTrack = useCallback(
    async (uri: string, deviceId?: string): Promise<void> => {
      const path = deviceId
        ? `/me/player/play?device_id=${encodeURIComponent(deviceId)}`
        : '/me/player/play';
      const res = await spotifyFetch(path, {
        method: 'PUT',
        body: JSON.stringify({ uris: [uri] }),
      });
      if (!res.ok && res.status !== 204) throw new Error(`playTrack failed: ${res.status}`);
    },
    [spotifyFetch],
  );

  const value = useMemo<SpotifyContextType>(
    () => ({
      isAuthenticated: !!accessToken,
      accessToken,
      login,
      logout,
      search,
      getDevices,
      transferPlayback,
      playTrack,
    }),
    [accessToken, login, logout, search, getDevices, transferPlayback, playTrack],
  );

  return <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>;
}

export function useSpotify(): SpotifyContextType {
  const ctx = useContext(SpotifyContext);
  if (!ctx) throw new Error('useSpotify must be used within <SpotifyProvider>');
  return ctx;
}
