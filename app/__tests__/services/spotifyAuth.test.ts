/**
 * Tests for the pure-JS PKCE + OAuth helpers in spotifyAuth.ts
 * No native modules needed — everything is pure TypeScript.
 */

import {
  generatePKCE,
  buildAuthorizeURL,
  exchangeCode,
  refreshAccessToken,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
} from '../../src/services/spotifyAuth';

// ── generatePKCE ─────────────────────────────────────────────────────────────

describe('generatePKCE', () => {
  it('returns a verifier and challenge', () => {
    const { verifier, challenge } = generatePKCE();
    expect(typeof verifier).toBe('string');
    expect(typeof challenge).toBe('string');
  });

  it('verifier is base64url safe (no +, /, or =)', () => {
    const { verifier } = generatePKCE();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it('challenge is base64url safe', () => {
    const { challenge } = generatePKCE();
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('verifier is at least 43 characters (RFC 7636 minimum)', () => {
    const { verifier } = generatePKCE();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('produces different values on each call', () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('verifier and challenge are different strings', () => {
    const { verifier, challenge } = generatePKCE();
    expect(verifier).not.toBe(challenge);
  });
});

// ── buildAuthorizeURL ─────────────────────────────────────────────────────────

describe('buildAuthorizeURL', () => {
  const clientId = 'test_client_id';
  const challenge = 'abc123challenge';

  it('starts with the Spotify authorize endpoint', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toMatch(/^https:\/\/accounts\.spotify\.com\/authorize/);
  });

  it('includes client_id', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toContain(`client_id=${clientId}`);
  });

  it('includes the correct redirect_uri', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toContain(encodeURIComponent(SPOTIFY_REDIRECT_URI));
  });

  it('includes response_type=code', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toContain('response_type=code');
  });

  it('includes code_challenge_method=S256', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toContain('code_challenge_method=S256');
  });

  it('includes the challenge value', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    expect(url).toContain(`code_challenge=${challenge}`);
  });

  it('includes expected scopes', () => {
    const url = buildAuthorizeURL(clientId, challenge);
    // SPOTIFY_SCOPES contains spaces so they're encoded as +
    expect(url).toContain('scope=');
    // At least one of the required scopes should appear
    expect(SPOTIFY_SCOPES).toContain('user-read-playback-state');
    expect(SPOTIFY_SCOPES).toContain('user-modify-playback-state');
  });
});

// ── exchangeCode ──────────────────────────────────────────────────────────────

describe('exchangeCode', () => {
  const fakeTokens = {
    access_token: 'access_abc',
    refresh_token: 'refresh_xyz',
    expires_in: 3600,
  };

  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('calls the Spotify token endpoint with the right params', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(fakeTokens));

    await exchangeCode('client_id', 'auth_code', 'verifier_value');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://accounts.spotify.com/api/token');
    expect(init.method).toBe('POST');
    expect(init.body).toContain('grant_type=authorization_code');
    expect(init.body).toContain('code=auth_code');
    expect(init.body).toContain('code_verifier=verifier_value');
  });

  it('returns parsed token data on success', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(fakeTokens));
    const result = await exchangeCode('client_id', 'auth_code', 'verifier_value');
    expect(result.access_token).toBe('access_abc');
    expect(result.refresh_token).toBe('refresh_xyz');
    expect(result.expires_in).toBe(3600);
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResponseOnce('invalid_grant', { status: 400 });
    await expect(exchangeCode('client_id', 'bad_code', 'verifier')).rejects.toThrow(
      'Token exchange failed',
    );
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe('refreshAccessToken', () => {
  const fakeTokens = {
    access_token: 'new_access',
    refresh_token: 'new_refresh',
    expires_in: 3600,
  };

  beforeEach(() => {
    fetchMock.resetMocks();
  });

  it('calls the token endpoint with grant_type=refresh_token', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(fakeTokens));

    await refreshAccessToken('client_id', 'old_refresh_token');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toContain('grant_type=refresh_token');
    expect(init.body).toContain('refresh_token=old_refresh_token');
  });

  it('returns new tokens on success', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(fakeTokens));
    const result = await refreshAccessToken('client_id', 'old_refresh');
    expect(result.access_token).toBe('new_access');
  });

  it('throws on non-OK response', async () => {
    fetchMock.mockResponseOnce('token_expired', { status: 400 });
    await expect(refreshAccessToken('client_id', 'bad_refresh')).rejects.toThrow(
      'Token refresh failed',
    );
  });
});
