import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Switch,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useSettings } from '../context/SettingsContext';
import { useSpotify } from '../context/SpotifyContext';

export default function SettingsScreen() {
  const {
    onlineUrl, offlineUrl, spotifyClientId,
    mode, controllerDisabled, setSetting,
  } = useSettings();
  const { isAuthenticated, login, logout } = useSpotify();

  const [onlineDraft,   setOnlineDraft]   = useState(onlineUrl);
  const [offlineDraft,  setOfflineDraft]  = useState(offlineUrl);
  const [clientIdDraft, setClientIdDraft] = useState(spotifyClientId);
  const [saved,         setSaved]         = useState(false);

  const handleModeChange = async (next: 'online' | 'offline') => {
    await setSetting('mode', next);
    if (next === 'offline') {
      Alert.alert(
        'Switch to Offline Mode',
        'Connect your phone to the "Campfire" WiFi network (password: campfire123), then the app will reach the bridge automatically.',
        [
          { text: 'Open WiFi Settings', onPress: () => Linking.openURL('App-Prefs:root=WIFI') },
          { text: 'Done', style: 'cancel' },
        ],
      );
    }
  };

  const handleSave = async () => {
    await setSetting('onlineUrl',       onlineDraft.trim());
    await setSetting('offlineUrl',      offlineDraft.trim());
    await setSetting('spotifyClientId', clientIdDraft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSpotifyLogin = async () => {
    if (!clientIdDraft.trim()) {
      Alert.alert('Client ID required', 'Enter your Spotify Client ID above and tap Save before connecting.');
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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Mode ──────────────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Mode</Text>
          <View style={styles.card}>
            <View style={styles.modeRow}>
              <Pressable
                style={[styles.modeBtn, mode === 'online' && styles.modeBtnActive]}
                onPress={() => handleModeChange('online')}
              >
                <Icon name="wifi" size={18} color={mode === 'online' ? '#fff' : '#777'} />
                <Text style={[styles.modeBtnText, mode === 'online' && styles.modeBtnTextActive]}>Online</Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === 'offline' && styles.modeBtnActive]}
                onPress={() => handleModeChange('offline')}
              >
                <Icon name="bluetooth" size={18} color={mode === 'offline' ? '#fff' : '#777'} />
                <Text style={[styles.modeBtnText, mode === 'offline' && styles.modeBtnTextActive]}>Offline</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {mode === 'online'
                ? 'Spotify Connect via bridge. Requires internet (WiFi or cellular via Tailscale).'
                : 'AirPlay from your phone to the bridge. Connect to "Campfire" WiFi — no internet needed.'}
            </Text>
          </View>

          {/* ── Offline instructions ──────────────────────────────── */}
          {mode === 'offline' && (
            <View style={styles.instructionCard}>
              <Text style={styles.instructionTitle}>Offline setup</Text>
              <Text style={styles.instructionStep}>1. Connect this phone to <Text style={styles.bold}>"Campfire"</Text> WiFi (pw: campfire123)</Text>
              <Text style={styles.instructionStep}>2. Enable Party mode in the Connections tab</Text>
              <Text style={styles.instructionStep}>3. AirPlay music from any app to <Text style={styles.bold}>"Campfire Bridge"</Text></Text>
              <Pressable style={styles.wifiBtn} onPress={() => Linking.openURL('App-Prefs:root=WIFI')}>
                <Icon name="wifi" size={15} color="#fff" />
                <Text style={styles.wifiBtnText}>Open WiFi Settings</Text>
              </Pressable>
            </View>
          )}

          {/* ── Bridge URLs ───────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Bridge</Text>
          <View style={styles.card}>
            <Text style={styles.label}>Online URL <Text style={styles.labelSub}>(Tailscale)</Text></Text>
            <TextInput
              style={[styles.input, mode === 'online' && styles.inputActive]}
              value={onlineDraft}
              onChangeText={setOnlineDraft}
              placeholder="http://100.x.x.x:3000"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text style={styles.label}>Offline URL <Text style={styles.labelSub}>(Campfire hotspot)</Text></Text>
            <TextInput
              style={[styles.input, mode === 'offline' && styles.inputActive]}
              value={offlineDraft}
              onChangeText={setOfflineDraft}
              placeholder="http://192.168.4.1:3000"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
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
              Create a free app at <Text style={styles.code}>developer.spotify.com</Text> and add{' '}
              <Text style={styles.code}>campfire://spotify-callback</Text> as a Redirect URI.
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

          {/* ── Player ───────────────────────────────────────────── */}
          <Text style={styles.sectionHeader}>Player</Text>
          <View style={styles.card}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleLabel}>
                <Text style={styles.label}>Disable Controller</Text>
                <Text style={styles.hint}>Hide Campfire's transport controls and use the Spotify app instead.</Text>
              </View>
              <Switch
                value={controllerDisabled}
                onValueChange={v => setSetting('controllerDisabled', v)}
                trackColor={{ false: '#333', true: '#1db954' }}
                thumbColor="#fff"
              />
            </View>
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
  root: { flex: 1, backgroundColor: '#121212' },
  scroll: { padding: 16, paddingBottom: 40 },

  sectionHeader: {
    color: '#aaa', fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 10, marginTop: 16,
  },
  card: {
    backgroundColor: '#1e1e1e', borderRadius: 12,
    padding: 16, marginBottom: 8, gap: 10,
  },
  instructionCard: {
    backgroundColor: '#1a2a1a', borderRadius: 12,
    borderWidth: 1, borderColor: '#2d5a2d',
    padding: 16, marginBottom: 8, gap: 8,
  },
  instructionTitle: { color: '#4caf50', fontWeight: '700', fontSize: 13 },
  instructionStep:  { color: '#bbb', fontSize: 13, lineHeight: 20 },
  bold:             { color: '#fff', fontWeight: '600' },
  wifiBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#2d5a2d', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 12,
    alignSelf: 'flex-start', marginTop: 4,
  },
  wifiBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  label:    { color: '#fff', fontSize: 14, fontWeight: '600' },
  labelSub: { color: '#777', fontWeight: '400', fontSize: 12 },
  input: {
    backgroundColor: '#2a2a2a', color: '#fff',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, borderWidth: 1, borderColor: '#333',
  },
  inputActive: { borderColor: '#1db954' },
  hint: { color: '#777', fontSize: 12, lineHeight: 18 },
  code: { color: '#1db954', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },

  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6, paddingVertical: 10,
    borderRadius: 8, backgroundColor: '#2a2a2a',
    borderWidth: 1, borderColor: '#333',
  },
  modeBtnActive:     { backgroundColor: '#1db954', borderColor: '#1db954' },
  modeBtnText:       { color: '#777', fontWeight: '600', fontSize: 14 },
  modeBtnTextActive: { color: '#fff' },

  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 10, gap: 8, marginTop: 4,
  },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnPrimary: { backgroundColor: '#0a84ff' },
  btnSaved:   { backgroundColor: '#1db954' },
  btnSpotify: { backgroundColor: '#1db954' },
  btnDanger:  { backgroundColor: '#c0392b' },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { flex: 1, gap: 4 },
});
