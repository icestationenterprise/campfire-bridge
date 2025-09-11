import React from 'react';
import { View, Text, Slider, StyleSheet } from 'react-native';

interface VolumeSliderProps {
value: number;
onValueChange: (value: number) => void;
}

export default function VolumeSlider({ value, onValueChange }: VolumeSliderProps) {
return (
<View style={styles.container}>
<Icon name="volume-down" size={24} color="#000" />
<Slider
style={styles.slider}
minimumValue={0}
maximumValue={100}
value={value}
onValueChange={onValueChange}
minimumTrackTintColor="#000"
maximumTrackTintColor="#ccc"
thumbStyle={{ backgroundColor: '#000' }}
/>
<Icon name="volume-up" size={24} color="#000" />
</View>
);
}

const styles = StyleSheet.create({
container: {
flexDirection: 'row',
alignItems: 'center',
width: '80%',
marginBottom: 20,
},
slider: {
flex: 1,
marginHorizontal: 10,
},
});
