import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';

import { SettingsProvider, useSettings } from './src/context/SettingsContext';
import BridgeProvider from './src/context/BridgeContext';
import { SpotifyProvider } from './src/context/SpotifyContext';

import NowPlayingScreen   from './src/screens/NowPlayingScreen';
import SpotifyLoginScreen from './src/screens/SpotifyLoginScreen';
import DevicesScreen      from './src/screens/DevicesScreen';
import SettingsScreen     from './src/screens/SettingsScreen';

// ── Navigator types ───────────────────────────────────────────────────────────

export type MusicStackParamList = {
  NowPlaying:   undefined;
  SpotifyLogin: undefined;
};

export type RootTabParamList = {
  MusicTab:       undefined;
  ConnectionsTab: undefined;
  SettingsTab:    undefined;
};

// ── Navigators ────────────────────────────────────────────────────────────────

const Tab   = createBottomTabNavigator<RootTabParamList>();
const Stack = createStackNavigator<MusicStackParamList>();

function MusicStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle:     { backgroundColor: '#121212' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: '700' },
        cardStyle:       { backgroundColor: '#121212' },
      }}
    >
      <Stack.Screen
        name="NowPlaying"
        component={NowPlayingScreen}
        options={{ title: 'Now Playing' }}
      />
      <Stack.Screen
        name="SpotifyLogin"
        component={SpotifyLoginScreen}
        options={{ title: 'Connect Spotify' }}
      />
    </Stack.Navigator>
  );
}

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
            MusicTab:       'queue-music',
            ConnectionsTab: 'bluetooth',
            SettingsTab:    'settings',
          };
          return <Icon name={icons[route.name] ?? 'circle'} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="MusicTab"       component={MusicStack}    options={{ title: 'Music' }} />
      <Tab.Screen name="ConnectionsTab" component={DevicesScreen}  options={{ title: 'Connections' }} />
      <Tab.Screen name="SettingsTab"    component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

// ── Context bridge: reads settings and injects into child providers ───────────

function AppWithContexts() {
  const { bridgeUrl, spotifyClientId } = useSettings();

  return (
    <BridgeProvider baseURL={bridgeUrl}>
      <SpotifyProvider clientId={spotifyClientId}>
        <SafeAreaProvider>
          <NavigationContainer>
            <AppTabs />
          </NavigationContainer>
        </SafeAreaProvider>
      </SpotifyProvider>
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
