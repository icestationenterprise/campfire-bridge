/**
 * DevicesScreen render + interaction tests.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import DevicesScreen from '../../src/screens/DevicesScreen';

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');
jest.mock('@react-native-community/slider', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ accessibilityLabel }: { accessibilityLabel?: string }) =>
    React.createElement(View, { accessibilityLabel });
});

const mockConnectBt    = jest.fn();
const mockDisconnectBt = jest.fn();
const mockFetchBt      = jest.fn();
const mockConnect      = jest.fn();
const mockDisconnect   = jest.fn();
const mockEnableParty  = jest.fn();
const mockDisableParty = jest.fn();
const mockSetSpeakerVolume = jest.fn();
const mockSetSpeakerMuted  = jest.fn();
const mockSetGroupVolume   = jest.fn();
const mockScanBt       = jest.fn();
const mockPairBt       = jest.fn();

const baseBridgeContext = {
  status:      {
    device: 'Test Bridge', connected: true, playing: false,
    track: { title: '', artist: '', position_ms: 0, duration_ms: 0 },
    volume: 60,
    party: { active: false, speakers: [] },
  },
  btDevices:         [],
  discoveredDevices: [],
  scanning:          false,
  isReachable:       true,
  baseURL:           'http://localhost:3000',
  connect:           mockConnect,
  disconnect:        mockDisconnect,
  fetchBtDevices:    mockFetchBt,
  connectBtDevice:   mockConnectBt,
  disconnectBtDevice: mockDisconnectBt,
  scanBtDevices:     mockScanBt,
  pairBtDevice:      mockPairBt,
  play: jest.fn(), pause: jest.fn(), next: jest.fn(), prev: jest.fn(),
  seek: jest.fn(), setVolume: jest.fn(), refresh: jest.fn(),
  partyStatus:      { active: false, speakers: [] },
  enableParty:      mockEnableParty,
  disableParty:     mockDisableParty,
  setSpeakerVolume: mockSetSpeakerVolume,
  setSpeakerMuted:  mockSetSpeakerMuted,
  setGroupVolume:   mockSetGroupVolume,
};

let mockCtx = { ...baseBridgeContext };

jest.mock('../../src/context/BridgeContext', () => ({
  useBridge: () => mockCtx,
}));

describe('DevicesScreen', () => {
  beforeEach(() => {
    mockCtx = { ...baseBridgeContext };
    jest.clearAllMocks();
  });

  // ── Basic render ──────────────────────────────────────────────────────────

  it('renders without crashing', () => {
    expect(() => render(<DevicesScreen />)).not.toThrow();
  });

  it('shows "Online" when bridge is reachable', () => {
    render(<DevicesScreen />);
    expect(screen.getByText('Online')).toBeTruthy();
  });

  it('shows "Offline" when bridge is unreachable', () => {
    mockCtx = { ...baseBridgeContext, isReachable: false };
    render(<DevicesScreen />);
    expect(screen.getByText('Offline')).toBeTruthy();
  });

  it('shows bridge URL', () => {
    render(<DevicesScreen />);
    expect(screen.getByText('http://localhost:3000')).toBeTruthy();
  });

  it('calls fetchBtDevices on mount when reachable', async () => {
    render(<DevicesScreen />);
    await waitFor(() => expect(mockFetchBt).toHaveBeenCalledTimes(1));
  });

  it('does not call fetchBtDevices when bridge is offline', async () => {
    mockCtx = { ...baseBridgeContext, isReachable: false };
    render(<DevicesScreen />);
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetchBt).not.toHaveBeenCalled();
  });

  // ── Paired speaker list ───────────────────────────────────────────────────

  it('shows empty state when no BT devices', () => {
    render(<DevicesScreen />);
    expect(screen.getByText(/no paired speakers/i)).toBeTruthy();
  });

  it('renders paired BT devices', () => {
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [
        { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', connected: true },
        { mac: 'AA:BB:CC:DD:EE:02', name: 'Bedroom Speaker',     connected: false },
      ],
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Living Room Speaker')).toBeTruthy();
    expect(screen.getByText('Bedroom Speaker')).toBeTruthy();
  });

  it('shows Disconnect button for connected devices', () => {
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker', connected: true }],
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Disconnect')).toBeTruthy();
  });

  it('shows Connect button for disconnected devices', () => {
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:02', name: 'Speaker', connected: false }],
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Connect')).toBeTruthy();
  });

  it('calls disconnectBtDevice when tapping Disconnect', async () => {
    mockDisconnectBt.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker', connected: true }],
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Disconnect Speaker'));
    await waitFor(() => expect(mockDisconnectBt).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01'));
  });

  it('calls connectBtDevice when tapping Connect', async () => {
    mockConnectBt.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:02', name: 'Speaker', connected: false }],
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Connect Speaker'));
    await waitFor(() => expect(mockConnectBt).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02'));
  });

  // ── Party mode ────────────────────────────────────────────────────────────

  it('shows Party section when bridge is reachable', () => {
    render(<DevicesScreen />);
    expect(screen.getByText('Party')).toBeTruthy();
  });

  it('Start button is disabled when no speakers are connected', () => {
    render(<DevicesScreen />);
    const btn = screen.getByLabelText('Start Party');
    expect(btn.props.accessibilityState?.disabled).toBe(true);
  });

  it('calls enableParty with all connected MACs when Start is pressed', async () => {
    mockEnableParty.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [
        { mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker A', connected: true },
        { mac: 'AA:BB:CC:DD:EE:02', name: 'Speaker B', connected: false },
      ],
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Start Party'));
    await waitFor(() =>
      expect(mockEnableParty).toHaveBeenCalledWith(['AA:BB:CC:DD:EE:01']),
    );
  });

  it('shows party member rows with speaker names when party is active', () => {
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room', connected: true }],
      partyStatus: {
        active: true,
        speakers: [{ mac: 'AA:BB:CC:DD:EE:01', volume: 80, muted: false }],
      },
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Living Room')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('calls disableParty when Stop is pressed', async () => {
    mockDisableParty.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker', connected: true }],
      partyStatus: { active: true, speakers: [{ mac: 'AA:BB:CC:DD:EE:01', volume: 80, muted: false }] },
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByText('Stop'));
    await waitFor(() => expect(mockDisableParty).toHaveBeenCalled());
  });

  it('calls setSpeakerMuted when toggling a speaker checkbox', async () => {
    mockSetSpeakerMuted.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker A', connected: true }],
      partyStatus: { active: true, speakers: [{ mac: 'AA:BB:CC:DD:EE:01', volume: 80, muted: false }] },
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Disable Speaker A'));
    await waitFor(() => expect(mockSetSpeakerMuted).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01', true));
  });

  // ── Scan & pair ───────────────────────────────────────────────────────────

  it('shows Scan for Speakers button', () => {
    render(<DevicesScreen />);
    expect(screen.getByLabelText('Scan for new speakers')).toBeTruthy();
  });

  it('calls scanBtDevices when scan button is pressed', async () => {
    mockScanBt.mockResolvedValue(undefined);
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Scan for new speakers'));
    await waitFor(() => expect(mockScanBt).toHaveBeenCalled());
  });

  it('shows discovered unpaired devices with Pair button', () => {
    mockCtx = {
      ...baseBridgeContext,
      discoveredDevices: [
        { mac: 'AA:BB:CC:DD:EE:03', name: 'Patio Speaker', paired: false },
      ],
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Patio Speaker')).toBeTruthy();
    expect(screen.getByLabelText('Pair Patio Speaker')).toBeTruthy();
  });

  it('calls pairBtDevice when Pair is pressed', async () => {
    mockPairBt.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      discoveredDevices: [
        { mac: 'AA:BB:CC:DD:EE:03', name: 'Patio Speaker', paired: false },
      ],
    };
    render(<DevicesScreen />);
    fireEvent.press(screen.getByLabelText('Pair Patio Speaker'));
    await waitFor(() => expect(mockPairBt).toHaveBeenCalledWith('AA:BB:CC:DD:EE:03'));
  });

  it('shows "Already paired" label for discovered devices that are already paired', () => {
    mockCtx = {
      ...baseBridgeContext,
      discoveredDevices: [
        { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room', paired: true },
      ],
    };
    render(<DevicesScreen />);
    expect(screen.getByText('Already paired')).toBeTruthy();
  });
});
