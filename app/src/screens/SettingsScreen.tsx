import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useSettings } from '../context/SettingsContext';
import { useSpotify } from '../context/SpotifyContext';

export default function SettingsScreen() {
  const { bridgeUrl, spotifyClientId, mode, setSetting } = useSettings();
  const { isAuthenticated, login, logout }               = useSpotify();

  const [urlDraft,      setUrlDraft]      = useState(bridgeUrl);
  const [clientIdDraft, setClientIdDraft] = useState(spotifyClientId);
  const [saved,         setSaved]         = useState(false);

  const handleSave = async () => {
    await Promise.all([
      setSetting('bridgeUrl',       urlDraft.trim()),
      setSetting('spotifyClientId', clientIdDraft.trim()),
    ]);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSpotifyLogin = async () => {
    if (!clientIdDraft.trim()) {
      Alert.alert(
        'Client ID required',
        'Enter your Spotify Client ID above and tap Save before connecting.',
      );
      return;
    }
    await login(clientIdDraft.trim());
  };

  const handleSpotifyLogout = () => {
    Alert.alert('Disconnect Spotify', 'Remove your Spotify account from Campfire?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => logout() },
    ]);
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Mode ──────────────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Mode</Text>
          <View style={styles.card}>
            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeBtn, mode === 'online'  && styles.modeBtnActive]}
                onPress={() => setSetting('mode', 'online')}
              >
                <Icon name="wifi" size={18} color={mode === 'online' ? '#fff' : '#777'} />
                <Text style={[styles.modeBtnText, mode === 'online' && styles.modeBtnTextActive]}>
                  Online
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === 'offline' && styles.modeBtnActive]}
                onPress={() => setSetting('mode', 'offline')}
              >
                <Icon name="bluetooth" size={18} color={mode === 'offline' ? '#fff' : '#777'} />
                <Text style={[styles.modeBtnText, mode === 'offline' && styles.modeBtnTextActive]}>
                  Offline
                </Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {mode === 'online'
                ? 'Spotify Connect via bridge. Requires internet (WiFi or cellular via Tailscale).'
                : 'Party mode — bridge syncs audio across all paired speakers. No internet needed. (Coming soon)'}
            </Text>
          </View>

          {/* ── Bridge ────────────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Bridge</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Bridge URL</Text>
            <TextInput
              style={styles.input}
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="http://192.168.1.42:8080"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.hint}>
              Use <Text style={styles.code}>http://localhost:3000</Text> while running the mock server.
              On your home network, enter the Pi's IP address.
            </Text>
          </View>

          {/* ── Spotify ───────────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Spotify</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Client ID</Text>
            <TextInput
              style={styles.input}
              value={clientIdDraft}
              onChangeText={setClientIdDraft}
              placeholder="Your Spotify app client ID"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.hint}>
              Create a free app at{' '}
              <Text style={styles.code}>developer.spotify.com</Text> and add{' '}
              <Text style={styles.code}>campfire://spotify-callback</Text> as a
              Redirect URI.
            </Text>

            {isAuthenticated ? (
              <Pressable style={[styles.btn, styles.btnDanger]} onPress={handleSpotifyLogout}>
                <Icon name="logout" size={16} color="#fff" />
                <Text style={styles.btnText}>Disconnect Spotify</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.btn, styles.btnSpotify]} onPress={handleSpotifyLogin}>
                <Icon name="library-music" size={16} color="#fff" />
                <Text style={styles.btnText}>Connect Spotify</Text>
              </Pressable>
            )}
          </View>

          {/* ── Save ─────────────────────────────────────────────── */}
          <Pressable
            style={[styles.btn, styles.btnPrimary, saved && styles.btnSaved]}
            onPress={handleSave}
          >
            <Icon name={saved ? 'check' : 'save'} size={16} color="#fff" />
            <Text style={styles.btnText}>{saved ? 'Saved!' : 'Save Settings'}</Text>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionHeader: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 16,
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    gap: 10,
  },
  label: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#2a2a2a',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#333',
  },
  hint: {
    color: '#777',
    fontSize: 12,
    lineHeight: 18,
  },
  code: {
    color: '#1db954',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
    marginTop: 4,
  },
  btnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#333',
  },
  modeBtnActive: {
    backgroundColor: '#1db954',
    borderColor: '#1db954',
  },
  modeBtnText: {
    color: '#777',
    fontWeight: '600',
    fontSize: 14,
  },
  modeBtnTextActive: {
    color: '#fff',
  },
  btnPrimary:  { backgroundColor: '#0a84ff' },
  btnSaved:    { backgroundColor: '#1db954' },
  btnSpotify:  { backgroundColor: '#1db954' },
  btnDanger:   { backgroundColor: '#c0392b' },
});
