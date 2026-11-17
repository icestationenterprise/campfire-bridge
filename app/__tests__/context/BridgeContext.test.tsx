/**
 * Tests for BridgeContext: status polling, party mode, BT device management.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import BridgeProvider, { useBridge } from '../../src/context/BridgeContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

const mockStatus = {
  device: 'Test Bridge',
  party: { active: false, speakers: [] },
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

// ── Party mode + AirPlay ───────────────────────────────────────────────────────

describe('BridgeContext — party mode', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    fetchMock.mockResponse(JSON.stringify(mockStatus));
  });

  it('enableParty() POSTs to /api/party/enable with macs', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.enableParty(['AA:BB:CC:DD:EE:01']); });

    const call = fetchMock.mock.calls.find(c => (c[0] as string).endsWith('/api/party/enable'));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.macs).toEqual(['AA:BB:CC:DD:EE:01']);
  });

  it('disableParty() POSTs to /api/party/disable', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.disableParty(); });

    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.endsWith('/api/party/disable'))).toBe(true);
  });

  it('setSpeakerVolume() POSTs to /api/party/speaker/volume with mac and volume', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.setSpeakerVolume('AA:BB:CC:DD:EE:01', 75); });

    const call = fetchMock.mock.calls.find(c => (c[0] as string).endsWith('/api/party/speaker/volume'));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body).toEqual({ mac: 'AA:BB:CC:DD:EE:01', volume: 75 });
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

// ── Device network mode ───────────────────────────────────────────────────────

describe('BridgeContext — device network mode', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    fetchMock.mockResponse(JSON.stringify(mockStatus));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('setDeviceNetworkMode() POSTs the mode to /api/network/mode', async () => {
    const { result } = renderHook(() => useBridge(), { wrapper });
    await waitFor(() => expect(result.current.isReachable).toBe(true));

    await act(async () => { await result.current.setDeviceNetworkMode('camping'); });

    const call = fetchMock.mock.calls.find(c => (c[0] as string).endsWith('/api/network/mode'));
    expect(call).toBeDefined();
    expect((call![1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ mode: 'camping' });
    expect(result.current.networkMode).toBe('camping');
  });

  it('holds the URL fallback after the device is told to switch, so the app does not flip back', async () => {
    jest.useFakeTimers();
    const FALLBACK   = 'http://192.168.4.1:3000';
    const onFallback = jest.fn();
    const wrapperWithFallback = ({ children }: { children: React.ReactNode }) => (
      <BridgeProvider baseURL={BASE_URL} fallbackUrl={FALLBACK} onFallback={onFallback}>{children}</BridgeProvider>
    );
    fetchMock.mockResponse(async req => {
      if (req.url.endsWith('/api/network/mode')) return JSON.stringify({ ok: true, requested: 'camping' });
      if (req.url.startsWith(BASE_URL)) return JSON.stringify(mockStatus);
      throw new Error('fallback must not be tried yet');
    });

    const { result } = renderHook(() => useBridge(), { wrapper: wrapperWithFallback });
    await waitFor(() => expect(result.current.isReachable).toBe(true));
    await act(async () => { await result.current.setDeviceNetworkMode('camping'); });

    // The device leaves home WiFi: the primary URL goes dark, the fallback would answer.
    fetchMock.mockResponse(async req => {
      if (req.url.startsWith(FALLBACK)) return JSON.stringify(mockStatus);
      throw new Error('primary down');
    });
    for (let i = 0; i < 6; i++) {
      await act(async () => { jest.advanceTimersByTime(2000); });
    }

    expect(onFallback).not.toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map(c => c[0] as string);
    expect(urls.some(u => u.startsWith(FALLBACK))).toBe(false);
  });
});
