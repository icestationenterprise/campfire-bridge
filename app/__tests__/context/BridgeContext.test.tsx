/**
 * Tests for BridgeContext: status polling, playback commands, BT device management.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import BridgeProvider, { useBridge } from '../../src/context/BridgeContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

const mockStatus = {
  device: 'Test Bridge',
  connected: true,
  playing: false,
  track: { title: 'Test Track', artist: 'Test Artist', position_ms: 0, duration_ms: 180000 },
  volume: 60,
};

const mockBtDevices = {
  devices: [
    { mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker 1', connected: true },
    { mac: 'AA:BB:CC:DD:EE:02', name: 'Speaker 2', connected: false },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <BridgeProvider baseURL={BASE_URL}>{children}</BridgeProvider>;
}

// ── Status polling ────────────────────────────────────────────────────────────

describe('BridgeContext — status polling', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fetches status on mount and sets isReachable=true', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockStatus));

    const { result } = renderHook(() => useBridge(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReachable).toBe(true);
    });
    expect(result.current.status?.device).toBe('Test Bridge');
    expect(result.current.status?.playing).toBe(false);
  });

  it('sets isReachable=false when the bridge is unreachable', async () => {
    fetchMock.mockRejectOnce(new Error('Network error'));

    const { result } = renderHook(() => useBridge(), { wrapper });

    await waitFor(() => {
      expect(result.current.isReachable).toBe(false);
    });
    expect(result.current.status).toBeNull();
  });

  it('polls the bridge every 2 seconds', async () => {
    fetchMock.mockResponse(JSON.stringify(mockStatus));

    renderHook(() => useBridge(), { wrapper });

    // Initial fetch
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1));

    const before = fetchMock.mock.calls.length;
    act(() => { jest.advanceTimersByTime(2000); });
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    });
  });
});

// ── Playback commands ─────────────────────────────────────────────────────────

describe('BridgeContext — playback commands', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    // First call: initial status poll; subsequent calls: command + refresh
    fetchMock.mockResponse(JSON.stringify(mockStatus));
  });

  it('play() POSTs to /api/play then refreshes status', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.play(); });

    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.endsWith('/api/play'))).toBe(true);
  });

  it('pause() POSTs to /api/pause', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.pause(); });

    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.endsWith('/api/pause'))).toBe(true);
  });

  it('next() POSTs to /api/next', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.next(); });

    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.endsWith('/api/next'))).toBe(true);
  });

  it('prev() POSTs to /api/previous', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.prev(); });

    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.endsWith('/api/previous'))).toBe(true);
  });

  it('seek() POSTs to /api/seek with position_ms', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.seek(45000); });

    const seekCall = fetchMock.mock.calls.find(c => (c[0] as string).endsWith('/api/seek'));
    expect(seekCall).toBeDefined();
    const body = JSON.parse((seekCall![1] as RequestInit).body as string);
    expect(body.position_ms).toBe(45000);
  });

  it('setVolume() POSTs to /api/volume with volume', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.setVolume(75); });

    const volCall = fetchMock.mock.calls.find(c => (c[0] as string).endsWith('/api/volume'));
    expect(volCall).toBeDefined();
    const body = JSON.parse((volCall![1] as RequestInit).body as string);
    expect(body.volume).toBe(75);
  });
});

// ── Bluetooth device management ───────────────────────────────────────────────

describe('BridgeContext — Bluetooth devices', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    fetchMock.mockResponse(JSON.stringify(mockStatus));
  });

  it('fetchBtDevices() populates btDevices', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockStatus)); // initial poll
    fetchMock.mockResponseOnce(JSON.stringify(mockBtDevices)); // fetchBtDevices

    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.fetchBtDevices(); });

    expect(result.current.btDevices).toHaveLength(2);
    expect(result.current.btDevices[0].name).toBe('Speaker 1');
  });

  it('connectBtDevice() POSTs to /api/bt/connect with mac', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockStatus));
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }));
    fetchMock.mockResponseOnce(JSON.stringify(mockBtDevices));

    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.connectBtDevice('AA:BB:CC:DD:EE:02'); });

    const connectCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).endsWith('/api/bt/connect'),
    );
    expect(connectCall).toBeDefined();
    const body = JSON.parse((connectCall![1] as RequestInit).body as string);
    expect(body.mac).toBe('AA:BB:CC:DD:EE:02');
  });

  it('disconnectBtDevice() POSTs to /api/bt/disconnect with mac', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockStatus));
    fetchMock.mockResponseOnce(JSON.stringify({ ok: true }));
    fetchMock.mockResponseOnce(JSON.stringify(mockBtDevices));

    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.disconnectBtDevice('AA:BB:CC:DD:EE:01'); });

    const disconnectCall = fetchMock.mock.calls.find(c =>
      (c[0] as string).endsWith('/api/bt/disconnect'),
    );
    expect(disconnectCall).toBeDefined();
    const body = JSON.parse((disconnectCall![1] as RequestInit).body as string);
    expect(body.mac).toBe('AA:BB:CC:DD:EE:01');
  });
});
