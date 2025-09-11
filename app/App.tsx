import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import DiscoveryScreen from './src/screens/DiscoveryScreen';
import NowPlayingScreen from './src/screens/NowPlayingScreen';
import DevicesScreen from './src/screens/DevicesScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SpotifyLoginScreen from './src/screens/SpotifyLoginScreen';

const Stack = createStackNavigator();

export default function App() {
return (
<NavigationContainer>
<Stack.Navigator initialRouteName="Discovery">
<Stack.Screen name="Discovery" component={DiscoveryScreen} />
<Stack.Screen name="NowPlaying" component={NowPlayingScreen} />
<Stack.Screen name="Devices" component={DevicesScreen} />
<Stack.Screen name="Settings" component={SettingsScreen} />
<Stack.Screen name="SpotifyLogin" component={SpotifyLoginScreen} />
</Stack.Navigator>
</NavigationContainer>
);
}
