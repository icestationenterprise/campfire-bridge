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
  homeUrl:    'http://localhost:3000',
  campingUrl: 'http://192.168.4.1:3000',
  mode:       'home' as const,
  isLoaded:   true,
};

jest.mock('../../src/context/SettingsContext', () => ({
  useSettings: () => ({ ...mockSettings, setSetting: mockSetSetting }),
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockSettings = {
      homeUrl:    'http://localhost:3000',
      campingUrl: 'http://192.168.4.1:3000',
      mode:       'home',
      isLoaded:   true,
    };
    jest.clearAllMocks();
  });

  it('renders without crashing', () => {
    expect(() => render(<SettingsScreen />)).not.toThrow();
  });

  it('shows the current home URL in the input', () => {
    render(<SettingsScreen />);
    const input = screen.getByDisplayValue('http://localhost:3000');
    expect(input).toBeTruthy();
  });

  it('shows the current camping URL in the input', () => {
    render(<SettingsScreen />);
    const input = screen.getByDisplayValue('http://192.168.4.1:3000');
    expect(input).toBeTruthy();
  });

  it('calls setSetting with new home URL when saved', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    const input = screen.getByDisplayValue('http://localhost:3000');
    fireEvent.changeText(input, 'http://192.168.1.50:8080');

    fireEvent.press(screen.getByText('Save Settings'));

    await waitFor(() => {
      expect(mockSetSetting).toHaveBeenCalledWith('homeUrl', 'http://192.168.1.50:8080');
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

  it('calls setSetting with mode=camping when Camping is pressed', async () => {
    mockSetSetting.mockResolvedValue(undefined);
    render(<SettingsScreen />);

    fireEvent.press(screen.getByText('Camping'));

    await waitFor(() => expect(mockSetSetting).toHaveBeenCalledWith('mode', 'camping'));
  });

  it('shows camping setup instructions when mode is camping', () => {
    mockSettings = { ...mockSettings, mode: 'camping' };
    render(<SettingsScreen />);
    expect(screen.getByText('Camping setup')).toBeTruthy();
  });
});
