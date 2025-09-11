import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

interface TransportControlsProps {
isPlaying: boolean;
onPlayPause: () => void;
onNext: () => void;
onPrevious: () => void;
}

export default function TransportControls({
isPlaying,
onPlayPause,
onNext,
onPrevious,
}: TransportControlsProps) {
return (
<View style={styles.container}>
<TouchableOpacity onPress={onPrevious} style={styles.button}>
<Icon name="skip-previous" size={40} color="#000" />
</TouchableOpacity>

<TouchableOpacity onPress={onPlayPause} style={styles.playButton}>
<Icon
name={isPlaying ? "pause" : "play-arrow"}
size={50}
color="#fff"
/>
</TouchableOpacity>

<TouchableOpacity onPress={onNext} style={styles.button}>
<Icon name="skip-next" size={40} color="#000" />
</TouchableOpacity>
</View>
);
}

const styles = StyleSheet.create({
container: {
flexDirection: 'row',
alignItems: 'center',
marginBottom: 30,
},
button: {
marginHorizontal: 20,
},
playButton: {
backgroundColor: '#000',
borderRadius: 30,
width: 60,
height: 60,
alignItems: 'center',
justifyContent: 'center',
},
});
