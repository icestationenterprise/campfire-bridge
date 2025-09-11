import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';

interface TrackInfoProps {
track: {
name: string;
artist: string;
album: string;
albumArt: string;
};
}

export default function TrackInfo({ track }: TrackInfoProps) {
if (!track) {
return (
<View style={styles.container}>
<Text>No track playing</Text>
</View>
);
}

return (
<View style={styles.container}>
<Image source={{ uri: track.albumArt }} style={styles.albumArt} />
<View style={styles.info}>
<Text style={styles.title}>{track.name}</Text>
<Text style={styles.artist}>{track.artist}</Text>
<Text style={styles.album}>{track.album}</Text>
</View>
</View>
);
}

const styles = StyleSheet.create({
container: {
flexDirection: 'row',
alignItems: 'center',
padding: 10,
},
albumArt: {
width: 60,
height: 60,
borderRadius: 5,
marginRight: 10,
},
info: {
flex: 1,
},
title: {
fontWeight: 'bold',
fontSize: 16,
},
artist: {
color: '#666',
},
album: {
color: '#999',
fontSize: 12,
},
});
