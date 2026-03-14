import React from 'react';
import Slider from '@react-native-community/slider';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Props = {
  value: number;
  onChange: (v: number) => void;
};

export default function VolumeSlider({ value, onChange }: Props) {
  return (
    <View style={{ paddingHorizontal: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="volume-mute" size={20} />
        <Slider
          style={{ flex: 1, marginHorizontal: 8 }}
          minimumValue={0}
          maximumValue={100}
          value={value}
          onValueChange={(v) => onChange(Math.round(v))}
          step={1}
        />
        <Icon name="volume-up" size={20} />
      </View>
      <Text style={{ textAlign: 'center', marginTop: 4 }}>{value}%</Text>
    </View>
  );
}
