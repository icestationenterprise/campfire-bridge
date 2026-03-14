import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import type { MusicStackParamList } from '../../App';
import Player from '../components/Player';
import { useSpotify } from '../context/SpotifyContext';

type Props = StackScreenProps<MusicStackParamList, 'NowPlaying'>;

export default function NowPlayingScreen({ navigation }: Props) {
  const { isAuthenticated } = useSpotify();

  return (
    <SafeAreaView style={styles.root}>
      {/* Spotify connect banner — shown when not yet authenticated */}
      {!isAuthenticated && (
        <Pressable
          style={styles.spotifyBanner}
          onPress={() => navigation.navigate('SpotifyLogin')}
          accessibilityLabel="Connect Spotify to browse and search music"
        >
          <Icon name="library-music" size={20} color="#1db954" />
          <Text style={styles.spotifyBannerText}>Connect Spotify to browse music</Text>
          <Icon name="chevron-right" size={20} color="#1db954" />
        </Pressable>
      )}

      {/* The player fills the rest of the screen */}
      <Player />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
  },
  spotifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#282828',
  },
  spotifyBannerText: {
    flex: 1,
    color: '#1db954',
    fontSize: 13,
    fontWeight: '500',
  },
});
