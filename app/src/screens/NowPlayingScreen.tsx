import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import TransportControls from '../components/TransportControls';
import VolumeSlider from '../components/VolumeSlider';
import { useBridge } from '../context/BridgeContext';

export default function NowPlayingScreen() {
const { track, isPlaying } = useBridge();
const [volume, setVolume] = useState(75);

return (
<View style={styles.container}>
<Image
source={{ uri: track?.albumArt || 'https://via.placeholder.com/300 ' }}
style={styles.albumArt}
/>
<Text style={styles.title}>{track?.name || 'No track playing'}</Text>
<Text style={styles.artist}>{track?.artist || 'Unknown artist'}</Text>

<TransportControls
isPlaying={isPlaying}
onPlayPause={() => {}}
onNext={() => {}}
onPrevious={() => {}}
/>

<VolumeSlider
value={volume}
onValueChange={setVolume}
/>
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
albumArt: {
width: 300,
height: 300,
borderRadius: 10,
marginBottom: 20,
},
title: {
fontSize: 24,
fontWeight: 'bold',
textAlign: 'center',
marginBottom: 10,
},
artist: {
fontSize: 18,
color: '#666',
marginBottom: 30,
},
});
