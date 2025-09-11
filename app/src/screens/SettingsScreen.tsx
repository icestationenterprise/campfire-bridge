import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import SamsungSoundAssist from '../modules/SamsungSoundAssist';

export default function SettingsScreen() {
return (
<View style={styles.container}>
<Text style={styles.title}>Settings</Text>

<Button title="WiFi Configuration" onPress={() => {}} />
<Button title="Bluetooth Pairing" onPress={() => {}} />
<Button title="Spotify Account" onPress={() => {}} />

<SamsungSoundAssist />

<Button title="About" onPress={() => {}} />
</View>
);
}

const styles = StyleSheet.create({
container: {
flex: 1,
padding: 20,
},
title: {
fontSize: 24,
fontWeight: 'bold',
marginBottom: 20,
},
});
