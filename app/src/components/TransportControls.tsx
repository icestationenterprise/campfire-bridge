import React from 'react';
import { View, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

type Props = {
  onPrev?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onNext?: () => void;
  isPlaying?: boolean;
};

export default function TransportControls({ onPrev, onPlay, onPause, onNext, isPlaying }: Props) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', padding: 12 }}>
      <Pressable onPress={onPrev}><Icon name="skip-previous" size={36} /></Pressable>
      {isPlaying
        ? <Pressable onPress={onPause}><Icon name="pause-circle-filled" size={52} /></Pressable>
        : <Pressable onPress={onPlay}><Icon name="play-circle-fill" size={52} /></Pressable>
      }
      <Pressable onPress={onNext}><Icon name="skip-next" size={36} /></Pressable>
    </View>
  );
}
