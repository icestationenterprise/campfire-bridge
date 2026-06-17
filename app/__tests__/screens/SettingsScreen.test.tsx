/**
 * SettingsScreen render + interaction tests.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../src/screens/SettingsScreen';

jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

// ── Mock contexts ─────────────────────────────────────────────────────────────

const mockSetSetting = jest.fn();
let   mockSettings   = {
  onlineUrl:  'http://localhost:3000',
  offlineUrl: 'http://192.168.4.1:3000',
  mode:       'online' as const,
  isLoaded:   true,
};

jest.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ ...mockSettings, setSetting: mockSetSetting }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockSettings = {
      onlineUrl:  'http://localhost:3000',
      offlineUrl: 'http://192.168.4.1:3000',
      mode:       'online',
      isLoaded:   true,
    };
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<SettingsScreen />)).not.toThrow();
  });

  it('shows the current online URL in the input', () => {
    render(<SettingsScreen />);
    const input = screen.getByDisplayValue('http://localhost:3000');
    expect(input).toBeTruthy();
  });

  it('shows the current offline URL in the input', () => {
    render(<SettingsScreen />);
    const input = screen.getByDisplayValue('http://192.168.4.1:3000');
    expect(input).toBeTruthy();
  });

  it('calls setSetting with new online URL when saved', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    const input = screen.getByDisplayValue('http://localhost:3000');
    fireEvent.changeText(input, 'http://192.168.1.50:8080');

    fireEvent.press(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith('onlineUrl', 'http://192.168.1.50:8080');
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

  it('calls setSetting with mode=offline when Offline is pressed', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Offline'));

    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('mode', 'offline'));
  });

  it('shows offline setup instructions when mode is offline', () => {
    mockSettings = { ...mockSettings, mode: 'offline' };
    render(<SettingsScreen />);
    expect(screen.getByText('Offline setup')).toBeTruthy();
  });
});
