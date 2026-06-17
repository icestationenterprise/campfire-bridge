import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { SettingsProvider, useSettings } from './src/context/SettingsContext';
import BridgeProvider from './src/context/BridgeContext';

import DevicesScreen      from './src/screens/DevicesScreen';
import SettingsScreen     from './src/screens/SettingsScreen';

// ── Navigator types ───────────────────────────────────────────────────────────

export type RootTabParamList = {
  ConnectionsTab: undefined;
  SettingsTab:    undefined;
};

// ── Navigators ────────────────────────────────────────────────────────────────

const Tab = createBottomTabNavigator<RootTabParamList>();

// ── Root tab navigator, wired to context values ───────────────────────────────

function AppTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }: { route: { name: string } }) => ({
        headerShown: false,
        tabBarStyle:           { backgroundColor: '#121212', borderTopColor: '#282828' },
        tabBarActiveTintColor:   '#1db954',
        tabBarInactiveTintColor: '#aaa',
        tabBarIcon: ({ color, size }: { color: string; size: number }) => {
          const icons: Record<string, string> = {
            ConnectionsTab: 'bluetooth',
            SettingsTab:    'settings',
          };
          return <Icon name={icons[route.name] ?? 'circle'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="ConnectionsTab" component={DevicesScreen}  options={{ title: 'Connections' }} />
      <Tab.Screen name="SettingsTab"    component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

// ── Context bridge: reads settings and injects into child providers ───────────

function AppWithContexts() {
  const { bridgeUrl, onlineUrl, offlineUrl, mode, setSetting } = useSettings();
  const fallbackUrl  = mode === 'online' ? offlineUrl : onlineUrl;
  const fallbackMode = mode === 'online' ? 'offline' : 'online';

  return (
    <BridgeProvider
      baseURL={bridgeUrl}
      fallbackUrl={fallbackUrl}
      onFallback={() => setSetting('mode', fallbackMode)}
    >
      <SafeAreaProvider>
        <NavigationContainer>
          <AppTabs />
        </NavigationContainer>
      </SafeAreaProvider>
    </BridgeProvider>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <SettingsProvider>
      <AppWithContexts />
    </SettingsProvider>
  );
}
