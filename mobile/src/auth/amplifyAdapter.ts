/**
 * Amplify v6 AuthAdapter implementation.
 *
 * This module wraps aws-amplify calls behind the AuthAdapter interface so
 * the rest of the application remains testable without a live Cognito pool.
 *
 * NOTE: aws-amplify is added as a dependency in issue #29 (device registration
 * and full Amplify wiring). This file is a placeholder that throws descriptive
 * errors until Amplify is configured with real User Pool values.
 */
import type { AuthAdapter, AuthUser } from './AuthContext';

export const amplifyAdapter: AuthAdapter = {
  async getCurrentUser(): Promise<AuthUser | null> {
    // In production this will call: await getCurrentUser() from 'aws-amplify/auth'
    // For now, return null so the app starts in the signed-out state.
    return null;
  },

  async signIn(email: string, _password: string): Promise<AuthUser> {
    // In production: await signIn({ username: email, password }) from 'aws-amplify/auth'
    // Amplify stores tokens securely in Keychain (iOS) / Keystore (Android).
    throw new Error(
      `Cognito not configured. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID ` +
        `environment variables and wire Amplify.configure() before sign-in. ` +
        `Attempted email: ${email}`,
    );
  },

  async signOut(): Promise<void> {
    // In production: await signOut() from 'aws-amplify/auth'
    throw new Error('Cognito not configured. Cannot sign out.');
  },
};
