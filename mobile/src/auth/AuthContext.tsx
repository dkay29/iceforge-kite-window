/**
 * Authentication context backed by Amazon Cognito via AWS Amplify.
 *
 * Usage:
 *   const { user, signIn, signOut, isLoading } = useAuth();
 *
 * AuthProvider must wrap the NavigationContainer in App.tsx.
 * Actual Amplify calls are injected as dependencies to enable unit testing.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface AuthUser {
  /** Cognito sub — stable UUID used as the S3 key prefix for user data. */
  sub: string;
  email: string;
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: string | null;
}

export interface AuthActions {
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

export type AuthContextValue = AuthState & AuthActions;

// ─── Adapter interface ────────────────────────────────────────────────────────

/**
 * Abstraction over Amplify auth calls.
 * Swap out in tests without touching the context logic.
 */
export interface AuthAdapter {
  getCurrentUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signOut(): Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

interface AuthProviderProps {
  children: React.ReactNode;
  adapter: AuthAdapter;
}

export function AuthProvider({ children, adapter }: AuthProviderProps): React.JSX.Element {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    error: null,
  });

  // Check for an existing session on mount
  useEffect(() => {
    let cancelled = false;
    adapter
      .getCurrentUser()
      .then((user) => {
        if (!cancelled) setState({ user, isLoading: false, error: null });
      })
      .catch(() => {
        if (!cancelled) setState({ user: null, isLoading: false, error: null });
      });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      try {
        const user = await adapter.signIn(email, password);
        setState({ user, isLoading: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sign-in failed';
        setState((s) => ({ ...s, isLoading: false, error: message }));
        throw err;
      }
    },
    [adapter],
  );

  const signOut = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      await adapter.signOut();
      setState({ user: null, isLoading: false, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-out failed';
      setState((s) => ({ ...s, isLoading: false, error: message }));
      throw err;
    }
  }, [adapter]);

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>{children}</AuthContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
