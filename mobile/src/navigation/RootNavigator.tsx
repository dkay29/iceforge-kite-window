/**
 * Root stack navigator.
 *
 * Screens:
 *   Today    — daily forecast and recommendation for the configured spot.
 *   Settings — user preferences and safety thresholds.
 */
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TodayScreen } from '../screens/TodayScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootStackParamList = {
  Today: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="Today">
      <Stack.Screen name="Today" component={TodayScreen} options={{ title: 'Kite Window' }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}
