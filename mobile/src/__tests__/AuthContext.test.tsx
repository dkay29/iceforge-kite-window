/**
 * Tests for AuthContext and AuthProvider.
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth, type AuthAdapter } from '../auth/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOCK_USER = { sub: 'user-sub-123', email: 'test@example.com' };

function makeAdapter(overrides: Partial<AuthAdapter> = {}): AuthAdapter {
  return {
    getCurrentUser: jest.fn().mockResolvedValue(null),
    signIn: jest.fn().mockResolvedValue(MOCK_USER),
    signOut: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function TestConsumer(): React.JSX.Element {
  const { user, isLoading, error } = useAuth();
  return (
    <>
      <Text testID="loading">{isLoading ? 'loading' : 'ready'}</Text>
      <Text testID="user">{user ? user.email : 'none'}</Text>
      <Text testID="error">{error ?? 'no-error'}</Text>
    </>
  );
}

function renderWithAuth(adapter: AuthAdapter) {
  return render(
    <AuthProvider adapter={adapter}>
      <TestConsumer />
    </AuthProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthProvider — initial state', () => {
  it('starts in loading state', async () => {
    const adapter = makeAdapter({
      getCurrentUser: jest.fn(() => new Promise(() => {})), // never resolves
    });
    const { getByTestId } = renderWithAuth(adapter);
    expect(getByTestId('loading').props.children).toBe('loading');
  });

  it('resolves to ready with no user when not authenticated', async () => {
    const { getByTestId } = renderWithAuth(makeAdapter());
    await waitFor(() => expect(getByTestId('loading').props.children).toBe('ready'));
    expect(getByTestId('user').props.children).toBe('none');
  });

  it('resolves to ready with user when session exists', async () => {
    const adapter = makeAdapter({ getCurrentUser: jest.fn().mockResolvedValue(MOCK_USER) });
    const { getByTestId } = renderWithAuth(adapter);
    await waitFor(() => expect(getByTestId('user').props.children).toBe(MOCK_USER.email));
  });
});

describe('AuthProvider — signIn', () => {
  it('updates user state on successful sign-in', async () => {
    let capturedSignIn!: (email: string, password: string) => Promise<void>;

    function SignInConsumer() {
      const { user, signIn } = useAuth();
      capturedSignIn = signIn;
      return <Text testID="user">{user ? user.email : 'none'}</Text>;
    }

    const adapter = makeAdapter();
    render(
      <AuthProvider adapter={adapter}>
        <SignInConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      await capturedSignIn('test@example.com', 'secret');
    });

    expect(adapter.signIn).toHaveBeenCalledWith('test@example.com', 'secret');
  });

  it('sets error state when sign-in fails', async () => {
    let capturedSignIn!: (email: string, password: string) => Promise<void>;

    function ErrorConsumer() {
      const { error, signIn } = useAuth();
      capturedSignIn = signIn;
      return <Text testID="error">{error ?? 'no-error'}</Text>;
    }

    const adapter = makeAdapter({
      signIn: jest.fn().mockRejectedValue(new Error('Bad credentials')),
    });
    const { getByTestId } = render(
      <AuthProvider adapter={adapter}>
        <ErrorConsumer />
      </AuthProvider>,
    );

    await act(async () => {
      try {
        await capturedSignIn('bad@email.com', 'wrong');
      } catch {
        // expected
      }
    });

    expect(getByTestId('error').props.children).toBe('Bad credentials');
  });
});

describe('AuthProvider — signOut', () => {
  it('clears user on successful sign-out', async () => {
    let capturedSignOut!: () => Promise<void>;

    function SignOutConsumer() {
      const { user, signOut } = useAuth();
      capturedSignOut = signOut;
      return <Text testID="user">{user ? user.email : 'none'}</Text>;
    }

    const adapter = makeAdapter({ getCurrentUser: jest.fn().mockResolvedValue(MOCK_USER) });
    const { getByTestId } = render(
      <AuthProvider adapter={adapter}>
        <SignOutConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(getByTestId('user').props.children).toBe(MOCK_USER.email));

    await act(async () => {
      await capturedSignOut();
    });

    expect(getByTestId('user').props.children).toBe('none');
  });
});

describe('useAuth', () => {
  it('throws when called outside AuthProvider', () => {
    // Suppress React error boundary output
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow('useAuth must be used inside AuthProvider');
    consoleSpy.mockRestore();
  });
});
