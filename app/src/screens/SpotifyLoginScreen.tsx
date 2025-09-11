import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

export default function SpotifyLoginScreen({ navigation }: any) {
const handleLogin = () => {
// Implement Spotify PKCE login flow
navigation.navigate('NowPlaying');
};

return (
<View style={styles.container}>
<Text style={styles.title}>Connect to Spotify</Text>
<Text style={styles.description}>
Log in to your Spotify account to control playback on your Campfire Bridge device.
</Text>
<Button title="Log in with Spotify" onPress={handleLogin} />
</View>
);
}

const styles = StyleSheet.create({
container: {
flex: 1,
alignItems: 'center',
justifyContent: 'center',
padding: 20,
},
title: {
fontSize: 24,
fontWeight: 'bold',
marginBottom: 20,
},
description: {
textAlign: 'center',
marginBottom: 30,
color: '#666',
},
});
