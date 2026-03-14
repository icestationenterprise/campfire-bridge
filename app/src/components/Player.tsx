import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useBridge } from '../context/BridgeContext';
import { formatTime } from '../utils/helpers';

/**
 * Full-featured music player UI.
 * Reads from and writes to BridgeContext — no props needed.
 */
export default function Player() {
  const { status, isReachable, play, pause, next, prev, seek, setVolume } = useBridge();
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  if (!isReachable) {
    return (
      <View style={styles.centered}>
        <Icon name="wifi-off" size={48} color="#aaa" />
        <Text style={styles.offlineText}>Bridge unreachable</Text>
        <Text style={styles.hint}>Make sure the mock server is running or the Pi is connected.</Text>
      </View>
    );
  }

  if (!status) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const { track, playing, volume } = status;
  const duration = Math.max(1, track.duration_ms || 1);
  const position = seeking ? seekValue : (track.position_ms || 0);

  return (
    <View style={styles.root}>
      {/* Track info */}
      <View style={styles.trackInfo}>
        <View style={styles.albumArt}>
          <Icon name="music-note" size={48} color="#fff" />
        </View>
        <Text style={styles.title} numberOfLines={1}>{track.title || '—'}</Text>
        <Text style={styles.artist} numberOfLines={1}>{track.artist || '—'}</Text>
      </View>

      {/* Seek bar */}
      <View style={styles.seekRow}>
        <Text style={styles.timeLabel}>{formatTime(position)}</Text>
        <Slider
          style={styles.seekSlider}
          minimumValue={0}
          maximumValue={duration}
          value={position}
          minimumTrackTintColor="#1db954"
          maximumTrackTintColor="#555"
          thumbTintColor="#1db954"
          onValueChange={(v) => { setSeeking(true); setSeekValue(v as number); }}
          onSlidingComplete={(v) => {
            setSeeking(false);
            seek(Math.round(v as number));
          }}
        />
        <Text style={styles.timeLabel}>{formatTime(duration)}</Text>
      </View>

      {/* Transport controls */}
      <View style={styles.controls}>
        <Pressable
          onPress={prev}
          style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
          accessibilityLabel="Previous track"
        >
          <Icon name="skip-previous" size={40} color="#fff" />
        </Pressable>

        <Pressable
          onPress={playing ? pause : play}
          style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}
          accessibilityLabel={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play-arrow'} size={48} color="#fff" />
        </Pressable>

        <Pressable
          onPress={next}
          style={({ pressed }) => [styles.controlBtn, pressed && styles.pressed]}
          accessibilityLabel="Next track"
        >
          <Icon name="skip-next" size={40} color="#fff" />
        </Pressable>
      </View>

      {/* Volume */}
      <View style={styles.volumeRow}>
        <Icon name="volume-mute" size={20} color="#aaa" />
        <Slider
          style={styles.volumeSlider}
          minimumValue={0}
          maximumValue={100}
          step={1}
          value={volume}
          minimumTrackTintColor="#1db954"
          maximumTrackTintColor="#555"
          thumbTintColor="#1db954"
          onSlidingComplete={(v) => setVolume(Math.round(v as number))}
        />
        <Icon name="volume-up" size={20} color="#aaa" />
      </View>
      <Text style={styles.volumeLabel}>{volume}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
    paddingHorizontal: 24,
    paddingBottom: 24,
    justifyContent: 'flex-end',
  },
  centered: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  offlineText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  hint: {
    color: '#aaa',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  trackInfo: {
    alignItems: 'center',
    marginBottom: 32,
  },
  albumArt: {
    width: 220,
    height: 220,
    borderRadius: 12,
    backgroundColor: '#282828',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  artist: {
    color: '#aaa',
    fontSize: 15,
    marginTop: 4,
    textAlign: 'center',
  },
  seekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  seekSlider: {
    flex: 1,
    marginHorizontal: 8,
  },
  timeLabel: {
    color: '#aaa',
    fontSize: 12,
    width: 38,
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    marginVertical: 16,
  },
  controlBtn: {
    padding: 8,
    borderRadius: 50,
  },
  playBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1db954',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  volumeSlider: {
    flex: 1,
    marginHorizontal: 8,
  },
  volumeLabel: {
    color: '#aaa',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
});
