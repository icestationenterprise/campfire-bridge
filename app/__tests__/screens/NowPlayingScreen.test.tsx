/**
 * NowPlayingScreen render tests.
 * Verifies the screen renders correctly for authenticated/unauthenticated states.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import NowPlayingScreen from '../../src/screens/NowPlayingScreen';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mock react-native-vector-icons to avoid native module requirement in tests
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

// Mock @react-native-community/slider
jest.mock('@react-native-community/slider', () => 'Slider');

// Mock react-navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/stack', () => ({
  createStackNavigator: jest.fn(),
}));

// Mock BridgeContext
const mockBridgeStatus = {
  device: 'Test Bridge',
  connected: true,
  playing: true,
  track: { title: 'Test Song', artist: 'Test Artist', position_ms: 30000, duration_ms: 180000 },
  volume: 70,
};

jest.mock('../../src/context/BridgeContext', () => ({
  useBridge: () => ({
    status:    mockBridgeStatus,
    isReachable: true,
    btDevices: [],
    baseURL:   'http://localhost:3000',
    play:      jest.fn(),
    pause:     jest.fn(),
    next:      jest.fn(),
    prev:      jest.fn(),
    seek:      jest.fn(),
    setVolume: jest.fn(),
    connect:    jest.fn(),
    disconnect: jest.fn(),
    refresh:    jest.fn(),
    fetchBtDevices:      jest.fn(),
    connectBtDevice:     jest.fn(),
    disconnectBtDevice:  jest.fn(),
  }),
}));

// Mock SpotifyContext
let mockIsAuthenticated = false;
jest.mock('../../src/context/SpotifyContext', () => ({
  useSpotify: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// Helper: minimal navigation prop
function makeProps(overrides = {}) {
  return {
    navigation: { navigate: mockNavigate, goBack: jest.fn() },
    route:      { key: 'NowPlaying', name: 'NowPlaying', params: undefined },
    ...overrides,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NowPlayingScreen', () => {
  beforeEach(() => {
    mockIsAuthenticated = false;
    mockNavigate.mockClear();
  });

  it('renders without crashing', () => {
    expect(() => render(<NowPlayingScreen {...makeProps()} />)).not.toThrow();
  });

  it('shows "Connect Spotify" banner when not authenticated', () => {
    mockIsAuthenticated = false;
    render(<NowPlayingScreen {...makeProps()} />);
    expect(screen.getByText(/connect spotify/i)).toBeTruthy();
  });

  it('hides the Spotify banner when authenticated', () => {
    mockIsAuthenticated = true;
    render(<NowPlayingScreen {...makeProps()} />);
    expect(screen.queryByText(/connect spotify/i)).toBeNull();
  });

  it('shows track title from bridge status', () => {
    render(<NowPlayingScreen {...makeProps()} />);
    expect(screen.getByText('Test Song')).toBeTruthy();
  });

  it('shows track artist from bridge status', () => {
    render(<NowPlayingScreen {...makeProps()} />);
    expect(screen.getByText('Test Artist')).toBeTruthy();
  });
});
