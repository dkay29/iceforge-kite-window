/**
 * Smoke tests for the individual screen components.
 *
 * React Navigation's native-stack uses native modules that are not available
 * in the Jest environment, so screens are rendered in isolation with mocked
 * navigation props (the recommended testing approach per React Navigation docs).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { TodayScreen } from '../screens/TodayScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

// Minimal navigation mock — only the props each screen actually reads.
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
} as unknown as Parameters<typeof TodayScreen>[0]['navigation'];

const mockRoute = {
  key: 'Today-1',
  name: 'Today' as const,
  params: undefined,
};

describe('TodayScreen', () => {
  it('renders placeholder text', () => {
    const { getByText } = render(<TodayScreen navigation={mockNavigation} route={mockRoute} />);
    expect(getByText('Forecast loading… (implementation in issue #27)')).toBeTruthy();
  });
});

describe('SettingsScreen', () => {
  it('renders placeholder text', () => {
    const settingsRoute = { key: 'Settings-1', name: 'Settings' as const, params: undefined };
    const { getByText } = render(
      <SettingsScreen
        navigation={mockNavigation as Parameters<typeof SettingsScreen>[0]['navigation']}
        route={settingsRoute}
      />,
    );
    expect(getByText('Settings (authentication and preferences in issue #26)')).toBeTruthy();
  });
});
