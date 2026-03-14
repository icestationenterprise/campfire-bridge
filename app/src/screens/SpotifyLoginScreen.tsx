import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import type { StackScreenProps } from '@react-navigation/stack';
import type { MusicStackParamList } from '../../App';
import { useSpotify } from '../context/SpotifyContext';
import { useSettings } from '../context/SettingsContext';

type Props = StackScreenProps<MusicStackParamList, 'SpotifyLogin'>;

export default function SpotifyLoginScreen({ navigation }: Props) {
  const { isAuthenticated, login, logout } = useSpotify();
  const { spotifyClientId }                = useSettings();
  const [loading, setLoading]              = useState(false);
  const [error,   setError]                = useState<string | null>(null);

  const handleLogin = async () => {
    if (!spotifyClientId) {
      setError('No Spotify Client ID configured. Go to Settings first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await login(spotifyClientId);
      // The actual callback is handled by SpotifyContext via Linking.
      // Navigate back — context will update isAuthenticated automatically.
      navigation.goBack();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Icon name="library-music" size={64} color="#1db954" />
        </View>

        <Text style={styles.title}>
          {isAuthenticated ? 'Spotify Connected' : 'Connect Spotify'}
        </Text>
        <Text style={styles.subtitle}>
          {isAuthenticated
            ? 'You are logged in. Campfire can now control Spotify playback and search for music.'
            : 'Log in so Campfire can control Spotify and play music through the bridge speaker.'}
        </Text>

        {error && (
          <View style={styles.errorBox}>
            <Icon name="error-outline" size={16} color="#e74c3c" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {isAuthenticated ? (
          <Pressable style={[styles.btn, styles.btnDanger]} onPress={handleLogout}>
            <Icon name="logout" size={18} color="#fff" />
            <Text style={styles.btnText}>Disconnect Spotify</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.btn, styles.btnSpotify, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Icon name="open-in-browser" size={18} color="#fff" />
            )}
            <Text style={styles.btnText}>
              {loading ? 'Opening Spotify…' : 'Log in with Spotify'}
            </Text>
          </Pressable>
        )}

        <Text style={styles.note}>
          Tapping "Log in with Spotify" opens the Spotify website in your browser.
          After you approve, the app will return here automatically.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 20,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#aaa',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a1010',
    borderRadius: 8,
    padding: 12,
    gap: 8,
    alignSelf: 'stretch',
  },
  errorText: {
    color: '#e74c3c',
    fontSize: 13,
    flex: 1,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 30,
    gap: 10,
    alignSelf: 'stretch',
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  btnSpotify:  { backgroundColor: '#1db954' },
  btnDanger:   { backgroundColor: '#c0392b' },
  btnDisabled: { opacity: 0.6 },
  note: {
    color: '#555',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 8,
  },
});
