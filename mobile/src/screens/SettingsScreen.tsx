/**
 * Settings screen — authentication and personal safety thresholds.
 *
 * Shows sign-in form when the user is unauthenticated.
 * Shows editable preferences when authenticated.
 *
 * Preference updates use ETag-based optimistic concurrency:
 *   1. Load current preferences + ETag on mount.
 *   2. Send ETag in If-Match on save.
 *   3. On 409 conflict, re-fetch and notify the user.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import {
  PreferencesService,
  EtagConflictError,
  PreferencesNotFoundError,
  type UserPreferences,
  type HttpClient,
} from '../services/preferencesService';
import type { RootStackParamList } from '../navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

// ─── Default preferences ──────────────────────────────────────────────────────

const DEFAULT_PREFS: Omit<UserPreferences, 'schemaVersion' | 'userId' | 'updatedAt'> = {
  windSpeed: {
    minimumUsableKnots: 12,
    preferredMinKnots: 15,
    preferredMaxKnots: 25,
    absoluteMaxKnots: 30,
  },
  windDirection: { acceptedSectors: ['DIRECT_ONSHORE', 'SIDE_ONSHORE'] },
  gust: { maxGustFactorRatio: 1.4 },
};

// ─── Placeholder HTTP client (to be replaced with Amplify REST in issue #29) ──

function makePlaceholderHttpClient(_authToken: string): HttpClient {
  return {
    get: async () => ({ status: 404, body: {}, headers: {} }),
    put: async () => ({ status: 200, body: {}, headers: { etag: 'placeholder' } }),
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SettingsScreen(_navProps: Props): React.JSX.Element {
  const { user, isLoading: authLoading, error: authError, signIn, signOut } = useAuth();

  // Sign-in form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  // Preferences state
  const [prefs, setPrefs] =
    useState<Omit<UserPreferences, 'schemaVersion' | 'userId' | 'updatedAt'>>(DEFAULT_PREFS);
  const [etag, setEtag] = useState<string | undefined>(undefined);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load preferences when authenticated
  useEffect(() => {
    if (user === null) return;
    const service = new PreferencesService(makePlaceholderHttpClient(user.sub));
    setPrefsLoading(true);
    service
      .get()
      .then((result) => {
        if (result !== null) {
          setPrefs({
            windSpeed: result.preferences.windSpeed,
            windDirection: result.preferences.windDirection,
            gust: result.preferences.gust,
            ...(result.preferences.notifications !== undefined && {
              notifications: result.preferences.notifications,
            }),
          });
          setEtag(result.etag);
        }
      })
      .catch((err) => {
        if (!(err instanceof PreferencesNotFoundError)) {
          Alert.alert('Error', 'Could not load preferences.');
        }
      })
      .finally(() => setPrefsLoading(false));
  }, [user]);

  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) return;
    setSigningIn(true);
    try {
      await signIn(email.trim(), password);
    } catch {
      Alert.alert('Sign-in failed', 'Check your email and password and try again.');
    } finally {
      setSigningIn(false);
    }
  }, [email, password, signIn]);

  const handleSave = useCallback(async () => {
    if (user === null) return;
    const service = new PreferencesService(makePlaceholderHttpClient(user.sub));
    setSaving(true);
    try {
      const result = await service.update({ preferences: prefs, etag });
      setEtag(result.etag);
      Alert.alert('Saved', 'Your preferences have been updated.');
    } catch (err) {
      if (err instanceof EtagConflictError) {
        Alert.alert('Conflict', 'Your preferences were updated on another device. Refreshing…');
        const fresh = await service.get();
        if (fresh !== null) {
          setPrefs({
            windSpeed: fresh.preferences.windSpeed,
            windDirection: fresh.preferences.windDirection,
            gust: fresh.preferences.gust,
          });
          setEtag(fresh.etag);
        }
      } else {
        Alert.alert('Error', 'Could not save preferences. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [user, prefs, etag]);

  if (authLoading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (user === null) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.heading}>Sign in</Text>
          {authError !== null && <Text style={styles.error}>{authError}</Text>}
          <TextInput
            style={styles.input}
            placeholder="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!signingIn}
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            editable={!signingIn}
          />
          <TouchableOpacity
            style={[styles.button, signingIn && styles.buttonDisabled]}
            onPress={handleSignIn}
            disabled={signingIn}
          >
            {signingIn ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Preferences</Text>
        <Text style={styles.sub}>{user.email}</Text>

        {prefsLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : (
          <View>
            <Text style={styles.sectionLabel}>Wind speed (knots)</Text>
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Minimum usable</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="numeric"
                value={String(prefs.windSpeed.minimumUsableKnots)}
                onChangeText={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    windSpeed: { ...p.windSpeed, minimumUsableKnots: Number(v) || 0 },
                  }))
                }
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Preferred min</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="numeric"
                value={String(prefs.windSpeed.preferredMinKnots)}
                onChangeText={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    windSpeed: { ...p.windSpeed, preferredMinKnots: Number(v) || 0 },
                  }))
                }
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Preferred max</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="numeric"
                value={String(prefs.windSpeed.preferredMaxKnots)}
                onChangeText={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    windSpeed: { ...p.windSpeed, preferredMaxKnots: Number(v) || 0 },
                  }))
                }
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Absolute max</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="numeric"
                value={String(prefs.windSpeed.absoluteMaxKnots)}
                onChangeText={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    windSpeed: { ...p.windSpeed, absoluteMaxKnots: Number(v) || 0 },
                  }))
                }
              />
            </View>

            <Text style={styles.sectionLabel}>Gust stability</Text>
            <View style={styles.row}>
              <Text style={styles.fieldLabel}>Max gust ratio</Text>
              <TextInput
                style={styles.numInput}
                keyboardType="numeric"
                value={String(prefs.gust.maxGustFactorRatio)}
                onChangeText={(v) =>
                  setPrefs((p) => ({
                    ...p,
                    gust: { maxGustFactorRatio: Number(v) || 1.0 },
                  }))
                }
              />
            </View>

            <TouchableOpacity
              style={[styles.button, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Save preferences</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 24 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  sub: { fontSize: 14, color: '#666', marginBottom: 24 },
  error: { color: '#c00', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  sectionLabel: { fontSize: 16, fontWeight: '600', marginTop: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  fieldLabel: { fontSize: 14, color: '#333', flex: 1 },
  numInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
    width: 70,
    textAlign: 'right',
    fontSize: 14,
  },
  loader: { marginTop: 24 },
  signOutButton: { marginTop: 32, alignItems: 'center' },
  signOutText: { color: '#c00', fontSize: 16 },
});
