/**
 * SettingsScreen render + interaction tests.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../src/screens/SettingsScreen';

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

// ── Mock contexts ─────────────────────────────────────────────────────────────

const mockSetSetting = jest.fn();
let   mockSettings   = { bridgeUrl: 'http://localhost:3000', spotifyClientId: '', isLoaded: true };

jest.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ ...mockSettings, setSetting: mockSetSetting }),
}));

const mockLogin  = jest.fn();
const mockLogout = jest.fn();
let   mockIsAuthenticated = false;

jest.mock('../../src/context/SpotifyContext', () => ({
  useSpotify: () => ({
    isAuthenticated: mockIsAuthenticated,
    login:  mockLogin,
    logout: mockLogout,
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockSettings        = { bridgeUrl: 'http://localhost:3000', spotifyClientId: '', isLoaded: true };
    mockIsAuthenticated = false;
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<SettingsScreen />)).not.toThrow();
  });

  it('shows the current bridge URL in the input', () => {
    render(<SettingsScreen />);
    const input = screen.getByDisplayValue('http://localhost:3000');
    expect(input).toBeTruthy();
  });

  it('shows "Connect Spotify" button when not authenticated', () => {
    mockIsAuthenticated = false;
    render(<SettingsScreen />);
    expect(screen.getByText('Connect Spotify')).toBeTruthy();
  });

  it('shows "Disconnect Spotify" button when authenticated', () => {
    mockIsAuthenticated = true;
    render(<SettingsScreen />);
    expect(screen.getByText('Disconnect Spotify')).toBeTruthy();
  });

  it('calls setSetting with new bridge URL when saved', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    const input = screen.getByDisplayValue('http://localhost:3000');
    fireEvent.changeText(input, 'http://192.168.1.50:8080');

    fireEvent.press(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith('bridgeUrl', 'http://192.168.1.50:8080');
    });
  });

  it('shows "Saved!" feedback after saving', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(screen.getByText('Saved!')).toBeTruthy();
    });
  });

  it('calls login when Connect Spotify is pressed with a client ID', async () => {
    mockLogin.mockResolvedValue(undefined);
    mockSettings = { bridgeUrl: 'http://localhost:3000', spotifyClientId: 'my_id', isLoaded: true };
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Connect Spotify'));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('my_id'));
  });

  it('shows the developer.spotify.com hint text', () => {
    render(<SettingsScreen />);
    expect(screen.getByText(/developer\.spotify\.com/)).toBeTruthy();
  });
});
