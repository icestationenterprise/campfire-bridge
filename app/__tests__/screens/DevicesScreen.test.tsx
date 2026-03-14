/**
 * DevicesScreen render + interaction tests.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import DevicesScreen from '../../src/screens/DevicesScreen';

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

const mockConnectBt    = jest.fn();
const mockDisconnectBt = jest.fn();
const mockFetchBt      = jest.fn();
const mockConnect      = jest.fn();
const mockDisconnect   = jest.fn();

const baseBridgeContext = {
  status:      { device: 'Test Bridge', connected: true, playing: false, track: { title: '', artist: '', position_ms: 0, duration_ms: 0 }, volume: 60 },
  btDevices:   [],
  isReachable: true,
  baseURL:     'http://localhost:3000',
  connect:     mockConnect,
  disconnect:  mockDisconnect,
  fetchBtDevices:     mockFetchBt,
  connectBtDevice:    mockConnectBt,
  disconnectBtDevice: mockDisconnectBt,
  play: jest.fn(), pause: jest.fn(), next: jest.fn(), prev: jest.fn(),
  seek: jest.fn(), setVolume: jest.fn(), refresh: jest.fn(),
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
    // Give it time to call if it was going to
    await new Promise(r => setTimeout(r, 50));
    expect(mockFetchBt).not.toHaveBeenCalled();
  });

  it('shows empty state when no BT devices', () => {
    render(<DevicesScreen />);
    expect(screen.getByText(/no bluetooth devices/i)).toBeTruthy();
  });

  it('renders a list of BT devices', () => {
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

  it('calls disconnectBtDevice when tapping Disconnect on a connected device', async () => {
    mockDisconnectBt.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:01', name: 'Speaker', connected: true }],
    };
    render(<DevicesScreen />);

    fireEvent.press(screen.getByLabelText('Disconnect Speaker'));
    await waitFor(() => expect(mockDisconnectBt).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01'));
  });

  it('calls connectBtDevice when tapping Connect on a disconnected device', async () => {
    mockConnectBt.mockResolvedValue(undefined);
    mockCtx = {
      ...baseBridgeContext,
      btDevices: [{ mac: 'AA:BB:CC:DD:EE:02', name: 'Speaker', connected: false }],
    };
    render(<DevicesScreen />);

    fireEvent.press(screen.getByLabelText('Connect Speaker'));
    await waitFor(() => expect(mockConnectBt).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02'));
  });
});
