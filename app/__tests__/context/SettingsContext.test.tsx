/**
 * Tests for SettingsContext: load from AsyncStorage, save, defaults.
 */

import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SettingsProvider, useSettings } from '../../src/context/SettingsContext';

// Mock AsyncStorage with a simple in-memory store
jest.mock('@react-native-async-storage/async-storage', () => {
  const store: Record<string, string> = {};
  return {
    getItem:    jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem:    jest.fn((key: string, value: string) => { store[key] = value; return Promise.resolve(); }),
    multiSet:   jest.fn((pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => { store[k] = v; });
      return Promise.resolve();
    }),
    multiGet:   jest.fn((keys: string[]) => Promise.resolve(keys.map(k => [k, store[k] ?? null]))),
    multiRemove: jest.fn((keys: string[]) => { keys.forEach(k => delete store[k]); return Promise.resolve(); }),
    removeItem: jest.fn((key: string) => { delete store[key]; return Promise.resolve(); }),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <SettingsProvider>{children}</SettingsProvider>;
}

describe('SettingsContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset getItem to return null so each test starts with empty storage
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  it('provides default values before AsyncStorage loads', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.bridgeUrl).toBe('http://localhost:3000');
    expect(result.current.spotifyClientId).toBe('');
    expect(result.current.isLoaded).toBe(false);
  });

  it('marks isLoaded=true after mount', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
  });

  it('loads saved settings from AsyncStorage', async () => {
    // Seed AsyncStorage with saved settings
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ bridgeUrl: 'http://192.168.1.10:8080', spotifyClientId: 'abc123' }),
    );

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.bridgeUrl).toBe('http://192.168.1.10:8080');
    expect(result.current.spotifyClientId).toBe('abc123');
  });

  it('setSetting updates state and persists to AsyncStorage', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.setSetting('bridgeUrl', 'http://10.0.0.5:8080');
    });

    expect(result.current.bridgeUrl).toBe('http://10.0.0.5:8080');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      '@campfire_settings',
      expect.stringContaining('10.0.0.5'),
    );
  });

  it('setSetting can update spotifyClientId independently', async () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.setSetting('spotifyClientId', 'my_client_id_xyz');
    });

    expect(result.current.spotifyClientId).toBe('my_client_id_xyz');
    // bridgeUrl should be unchanged
    expect(result.current.bridgeUrl).toBe('http://localhost:3000');
  });

  it('falls back to defaults when AsyncStorage read fails', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('Storage error'));

    const { result } = renderHook(() => useSettings(), { wrapper });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    expect(result.current.bridgeUrl).toBe('http://localhost:3000');
  });

  it('throws if useSettings is used outside SettingsProvider', () => {
    // Suppress the expected error console output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSettings())).toThrow(
      'useSettings must be used within <SettingsProvider>',
    );
    spy.mockRestore();
  });
});
