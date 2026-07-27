/**
 * Smoke tests for the individual screen components.
 *
 * React Navigation's native-stack uses native modules not available in Jest,
 * so screens are rendered in isolation with mocked navigation props.
 * SettingsScreen requires AuthProvider — a null-user adapter is used here.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { TodayScreen } from '../screens/TodayScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { AuthProvider, type AuthAdapter } from '../auth/AuthContext';

// ─── Auth adapter that returns no current user (unauthenticated) ──────────────

const noUserAdapter: AuthAdapter = {
  getCurrentUser: jest.fn().mockResolvedValue(null),
  signIn: jest.fn(),
  signOut: jest.fn(),
};

// ─── Navigation mock ──────────────────────────────────────────────────────────

const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
} as unknown as Parameters<typeof TodayScreen>[0]['navigation'];

const todayRoute = { key: 'Today-1', name: 'Today' as const, params: undefined };
const settingsRoute = { key: 'Settings-1', name: 'Settings' as const, params: undefined };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TodayScreen', () => {
  it('renders a loading indicator on mount while fetching forecast', () => {
    // TodayScreen starts in loading state while it fetches the forecast from the API.
    const { UNSAFE_getAllByType } = render(
      <TodayScreen navigation={mockNavigation} route={todayRoute} />,
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ActivityIndicator } = require('react-native');
    expect(UNSAFE_getAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });
});

describe('SettingsScreen', () => {
  it('renders sign-in form when unauthenticated', async () => {
    const { getAllByText } = render(
      <AuthProvider adapter={noUserAdapter}>
        <SettingsScreen
          navigation={mockNavigation as Parameters<typeof SettingsScreen>[0]['navigation']}
          route={settingsRoute}
        />
      </AuthProvider>,
    );
    // After auth resolves (no user), the sign-in form is shown (heading + button both say "Sign in")
    await waitFor(
      () => {
        expect(getAllByText('Sign in').length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 10000 },
    );
  }, 15000);
});
