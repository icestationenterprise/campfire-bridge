import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
  ScrollView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {
  useBridge,
  BluetoothDevice,
  DiscoveredDevice,
  SpeakerState,
} from '../context/BridgeContext';

// ── Sub-components ────────────────────────────────────────────────────────────

/** A single row for a speaker that is currently in the party. */
function PartyMemberRow({
  speaker,
  device,
  onVolumeChange,
  onMuteToggle,
  onSyncAdjust,
}: {
  speaker: SpeakerState;
  device: BluetoothDevice | undefined;
  onVolumeChange: (mac: string, vol: number) => void;
  onMuteToggle:   (mac: string, muted: boolean) => void;
  onSyncAdjust:   (mac: string, deltaMs: number) => void;
}) {
  // Track slider value locally so it moves smoothly while dragging
  const [localVol, setLocalVol] = useState(speaker.volume);
  useEffect(() => { setLocalVol(speaker.volume); }, [speaker.volume]);

  return (
    <View style={styles.partyMemberCard}>
      {/* Top row: checkbox + name */}
      <View style={styles.partyMemberTop}>
        <Pressable
          style={[styles.checkbox, !speaker.muted && styles.checkboxChecked]}
          onPress={() => onMuteToggle(speaker.mac, !speaker.muted)}
          accessibilityLabel={
            speaker.muted
              ? `Enable ${device?.name ?? speaker.mac}`
              : `Disable ${device?.name ?? speaker.mac}`
          }
        >
          {!speaker.muted && <Icon name="check" size={14} color="#fff" />}
        </Pressable>

        <View style={styles.partyMemberInfo}>
          <Text style={[styles.deviceName, speaker.muted && styles.mutedText]}>
            {device?.name ?? speaker.mac}
          </Text>
          <Text style={styles.deviceSub}>{speaker.mac}</Text>
        </View>

        <Text style={[styles.volumeLabel, speaker.muted && styles.mutedText]}>
          {speaker.muted ? 'Muted' : `${Math.round(localVol)}%`}
        </Text>
      </View>

      {/* Volume slider */}
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={100}
        step={1}
        value={localVol}
        disabled={speaker.muted}
        minimumTrackTintColor={speaker.muted ? '#555' : '#f39c12'}
        maximumTrackTintColor="#333"
        thumbTintColor={speaker.muted ? '#555' : '#f39c12'}
        onValueChange={setLocalVol}
        onSlidingComplete={val => onVolumeChange(speaker.mac, val)}
        accessibilityLabel={`Volume for ${device?.name ?? speaker.mac}`}
      />

      {/* Sync adjustment — tap if this speaker is ahead or behind the others */}
      <View style={styles.syncRow}>
        <Text style={styles.syncLabel}>Sync</Text>
        <Pressable
          style={styles.syncBtn}
          onPress={() => onSyncAdjust(speaker.mac, -25)}
          accessibilityLabel={`${device?.name ?? speaker.mac} earlier`}
        >
          <Text style={styles.syncBtnText}>◀ Earlier</Text>
        </Pressable>
        <Text style={styles.syncValue}>{speaker.calibration_ms ?? 0}ms</Text>
        <Pressable
          style={styles.syncBtn}
          onPress={() => onSyncAdjust(speaker.mac, 25)}
          accessibilityLabel={`${device?.name ?? speaker.mac} later`}
        >
          <Text style={styles.syncBtnText}>Later ▶</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DevicesScreen() {
  const {
    status,
    btDevices,
    discoveredDevices,
    scanning,
    isReachable,
    baseURL,
    connect,
    disconnect,
    fetchBtDevices,
    connectBtDevice,
    disconnectBtDevice,
    scanBtDevices,
    pairBtDevice,
    partyStatus,
    enableParty,
    disableParty,
    setSpeakerVolume,
    setSpeakerMuted,
    setGroupVolume,
    adjustSpeakerSync,
    offlineActive,
    enableOfflineParty,
    disableOfflineParty,
  } = useBridge();

  const [loadingMac,     setLoadingMac]     = useState<string | null>(null);
  const [pairingMac,     setPairingMac]     = useState<string | null>(null);
  const [partyLoading,   setPartyLoading]   = useState(false);
  const [offlineLoading, setOfflineLoading] = useState(false);
  const [refreshing,     setRefreshing]     = useState(false);
  const [btError,        setBtError]        = useState<string | null>(null);

  // Group slider local state
  const [groupVol, setGroupVol] = useState(80);
  useEffect(() => {
    if (partyStatus.speakers.length > 0) {
      const avg = partyStatus.speakers.reduce((s, sp) => s + sp.volume, 0)
        / partyStatus.speakers.length;
      setGroupVol(Math.round(avg));
    }
  }, [partyStatus.speakers]);

  useEffect(() => {
    if (isReachable) fetchBtDevices();
  }, [isReachable, fetchBtDevices]);

  // Auto-scan continuously while this tab is focused
  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function loop() {
        while (active && isReachable) {
          try { await scanBtDevices(); } catch { /* ignore transient scan errors */ }
          if (!active) break;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      loop().catch(() => {});
      return () => { active = false; };
    }, [isReachable, scanBtDevices]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBtDevices();
    setRefreshing(false);
  }, [fetchBtDevices]);

  const handleBridgeToggle = useCallback(async () => {
    try {
      if (status?.connected) { await disconnect(); } else { await connect(); }
    } catch { /* status will update on next poll */ }
  }, [status, connect, disconnect]);

  const handleBtConnect = useCallback(async (mac: string) => {
    setBtError(null);
    setLoadingMac(mac);
    try {
      await connectBtDevice(mac);
    } catch (e) {
      setBtError((e as Error).message);
    } finally {
      setLoadingMac(null);
    }
  }, [connectBtDevice]);

  const handleBtDisconnect = useCallback(async (device: BluetoothDevice) => {
    setBtError(null);
    setLoadingMac(device.mac);
    try {
      await disconnectBtDevice(device.mac);
    } catch (e) {
      setBtError((e as Error).message);
    } finally {
      setLoadingMac(null);
    }
  }, [disconnectBtDevice]);

  const handlePair = useCallback(async (mac: string) => {
    setBtError(null);
    setPairingMac(mac);
    try {
      await pairBtDevice(mac);
    } catch (e) {
      setBtError((e as Error).message);
    } finally {
      setPairingMac(null);
    }
  }, [pairBtDevice]);

  const handleStartParty = useCallback(async () => {
    const connectedMacs = btDevices.filter(d => d.connected).map(d => d.mac);
    if (connectedMacs.length === 0) return;
    setPartyLoading(true);
    try { await enableParty(connectedMacs); } finally { setPartyLoading(false); }
  }, [btDevices, enableParty]);

  const handleStopParty = useCallback(async () => {
    setPartyLoading(true);
    try { await disableParty(); } finally { setPartyLoading(false); }
  }, [disableParty]);

  const handleStartOffline = useCallback(async () => {
    const connectedMacs = btDevices.filter(d => d.connected).map(d => d.mac);
    if (connectedMacs.length === 0) return;
    setOfflineLoading(true);
    try { await enableOfflineParty(connectedMacs); } finally { setOfflineLoading(false); }
  }, [btDevices, enableOfflineParty]);

  const handleStopOffline = useCallback(async () => {
    setOfflineLoading(true);
    try { await disableOfflineParty(); } finally { setOfflineLoading(false); }
  }, [disableOfflineParty]);

  const handleMuteToggle = useCallback((mac: string, muted: boolean) => {
    setSpeakerMuted(mac, muted);
  }, [setSpeakerMuted]);

  const handleSpeakerVolume = useCallback((mac: string, vol: number) => {
    setSpeakerVolume(mac, vol);
  }, [setSpeakerVolume]);

  const handleSyncAdjust = useCallback(async (mac: string, deltaMs: number) => {
    try { await adjustSpeakerSync(mac, deltaMs); } catch { /* non-fatal */ }
  }, [adjustSpeakerSync]);

  // Online party = party active but NOT via AirPlay/offline mode
  const onlinePartyActive = partyStatus.active && !offlineActive;

  // Devices not yet in the party (connected but party hasn't started, or
  // connected after party started and auto-add hasn't run yet)
  const partyMacs = new Set(partyStatus.speakers.map(s => s.mac));
  const connectedNotInParty = btDevices.filter(
    d => d.connected && !partyMacs.has(d.mac),
  );
  const disconnectedPaired = btDevices.filter(d => !d.connected);

  // Discovered but not yet paired
  const newDevices = discoveredDevices.filter(d => !d.paired);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#1db954" />
        }
      >
        {/* ── BT error banner ─────────────────────────────────────────────── */}
        {btError && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{btError}</Text>
          </View>
        )}

        {/* ── Bridge card ─────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>Bridge</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Icon
                  name={isReachable ? 'wifi' : 'wifi-off'}
                  size={22}
                  color={isReachable ? '#1db954' : '#e74c3c'}
                />
                <View style={styles.labelStack}>
                  <Text style={styles.deviceName}>Campfire Bridge</Text>
                  <Text style={styles.deviceSub}>{baseURL}</Text>
                </View>
              </View>
              <View style={[styles.pill, isReachable ? styles.pillGreen : styles.pillRed]}>
                <Text style={styles.pillText}>{isReachable ? 'Online' : 'Offline'}</Text>
              </View>
            </View>

            {isReachable && (
              <Pressable
                style={[styles.actionBtn, status?.connected ? styles.btnDanger : styles.btnGreen]}
                onPress={handleBridgeToggle}
              >
                <Text style={styles.actionBtnText}>
                  {status?.connected ? 'Disconnect Bridge' : 'Connect Bridge'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* ── Party ───────────────────────────────────────────────────────── */}
        {isReachable && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Party</Text>

            {/* Control row */}
            <View style={styles.partyControlCard}>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Icon
                    name={partyStatus.active ? 'surround-sound' : 'speaker-group'}
                    size={24}
                    color={partyStatus.active ? '#f39c12' : '#aaa'}
                  />
                  <Text style={[styles.deviceName, { marginLeft: 12 }]}>
                    {partyStatus.active
                      ? `${partyStatus.speakers.length} speaker${partyStatus.speakers.length !== 1 ? 's' : ''} in sync`
                      : 'Party off'}
                  </Text>
                </View>

                {partyLoading ? (
                  <ActivityIndicator size="small" color="#f39c12" />
                ) : onlinePartyActive ? (
                  <Pressable style={[styles.smallBtn, styles.btnDanger]} onPress={handleStopParty}>
                    <Text style={styles.smallBtnText}>Stop</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[
                      styles.smallBtn,
                      btDevices.some(d => d.connected) && !offlineActive ? styles.btnParty : styles.btnDisabled,
                    ]}
                    onPress={handleStartParty}
                    disabled={!btDevices.some(d => d.connected) || offlineActive}
                    accessibilityLabel="Start Party"
                  >
                    <Text style={styles.smallBtnText}>Start</Text>
                  </Pressable>
                )}
              </View>

              {/* Group volume slider — shown when party is active */}
              {partyStatus.active && partyStatus.speakers.length > 0 && (
                <View style={styles.groupVolumeRow}>
                  <Icon name="volume-down" size={18} color="#aaa" />
                  <Slider
                    style={styles.groupSlider}
                    minimumValue={0}
                    maximumValue={100}
                    step={1}
                    value={groupVol}
                    minimumTrackTintColor="#f39c12"
                    maximumTrackTintColor="#333"
                    thumbTintColor="#f39c12"
                    onValueChange={setGroupVol}
                    onSlidingComplete={setGroupVolume}
                    accessibilityLabel="Group volume"
                  />
                  <Icon name="volume-up" size={18} color="#aaa" />
                  <Text style={styles.groupVolLabel}>{Math.round(groupVol)}%</Text>
                </View>
              )}
            </View>

            {/* Party member rows (speakers currently in the combined sink) */}
            {partyStatus.active && partyStatus.speakers.map(speaker => (
              <PartyMemberRow
                key={speaker.mac}
                speaker={speaker}
                device={btDevices.find(d => d.mac === speaker.mac)}
                onVolumeChange={handleSpeakerVolume}
                onMuteToggle={handleMuteToggle}
                onSyncAdjust={handleSyncAdjust}
              />
            ))}

            {/* Connected speakers not yet in party — show Add button */}
            {partyStatus.active && connectedNotInParty.map(device => (
              <View key={device.mac} style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Icon name="bluetooth-connected" size={20} color="#1db954" />
                    <View style={styles.labelStack}>
                      <Text style={styles.deviceName}>{device.name}</Text>
                      <Text style={styles.deviceSub}>Connected — not in party</Text>
                    </View>
                  </View>
                  <Pressable
                    style={[styles.smallBtn, styles.btnParty]}
                    onPress={async () => {
                      setPartyLoading(true);
                      try {
                        const allMacs = [...partyStatus.speakers.map(s => s.mac), device.mac];
                        await enableParty(allMacs);
                      } finally { setPartyLoading(false); }
                    }}
                  >
                    <Text style={styles.smallBtnText}>Add</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Offline party mode (AirPlay) ────────────────────────────────── */}
        {isReachable && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Offline Party</Text>
            <View style={[styles.partyControlCard, offlineActive && styles.offlineActiveCard]}>
              <View style={styles.row}>
                <View style={styles.rowLeft}>
                  <Icon
                    name="airplay"
                    size={24}
                    color={offlineActive ? '#5b9cf6' : '#aaa'}
                  />
                  <View style={styles.labelStack}>
                    <Text style={styles.deviceName}>
                      {offlineActive ? 'AirPlay Active' : 'AirPlay Off'}
                    </Text>
                    <Text style={styles.deviceSub}>
                      {offlineActive
                        ? 'Open any music app → AirPlay → Campfire Bridge'
                        : 'Stream from iPhone without internet'}
                    </Text>
                  </View>
                </View>

                {offlineLoading ? (
                  <ActivityIndicator size="small" color="#5b9cf6" />
                ) : offlineActive ? (
                  <Pressable
                    style={[styles.smallBtn, styles.btnDanger]}
                    onPress={handleStopOffline}
                  >
                    <Text style={styles.smallBtnText}>Stop</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    style={[
                      styles.smallBtn,
                      btDevices.some(d => d.connected) && !onlinePartyActive ? styles.btnOffline : styles.btnDisabled,
                    ]}
                    onPress={handleStartOffline}
                    disabled={!btDevices.some(d => d.connected) || onlinePartyActive}
                  >
                    <Text style={styles.smallBtnText}>Start</Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Paired speakers (not in party / party off) ───────────────────── */}
        {isReachable && !partyStatus.active && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Bluetooth Speakers</Text>

            {btDevices.length === 0 ? (
              <View style={styles.emptyState}>
                <Icon name="bluetooth-searching" size={36} color="#555" />
                <Text style={styles.emptyText}>No paired speakers</Text>
                <Text style={styles.emptyHint}>Scan below to find new ones</Text>
              </View>
            ) : (
              btDevices.map(device => (
                <View key={device.mac} style={styles.card}>
                  <View style={styles.row}>
                    <View style={styles.rowLeft}>
                      <Icon
                        name={device.connected ? 'bluetooth-connected' : 'bluetooth'}
                        size={22}
                        color={device.connected ? '#1db954' : '#aaa'}
                      />
                      <View style={styles.labelStack}>
                        <Text style={styles.deviceName}>{device.name}</Text>
                        <Text style={styles.deviceSub}>{device.mac}</Text>
                      </View>
                    </View>

                    {loadingMac === device.mac ? (
                      <ActivityIndicator size="small" color="#1db954" />
                    ) : device.connected ? (
                      <Pressable
                        style={[styles.smallBtn, styles.btnDanger]}
                        onPress={() => handleBtDisconnect(device)}
                        accessibilityLabel={`Disconnect ${device.name}`}
                      >
                        <Text style={styles.smallBtnText}>Disconnect</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        style={[styles.smallBtn, styles.btnGreen]}
                        onPress={() => handleBtConnect(device.mac)}
                        accessibilityLabel={`Connect ${device.name}`}
                      >
                        <Text style={styles.smallBtnText}>Connect</Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* ── Disconnected speakers during party ──────────────────────────── */}
        {isReachable && partyStatus.active && disconnectedPaired.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>Offline Speakers</Text>
            {disconnectedPaired.map(device => (
              <View key={device.mac} style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.rowLeft}>
                    <Icon name="bluetooth-disabled" size={20} color="#555" />
                    <View style={styles.labelStack}>
                      <Text style={[styles.deviceName, styles.mutedText]}>{device.name}</Text>
                      <Text style={styles.deviceSub}>Turn on to join the party</Text>
                    </View>
                  </View>
                  {loadingMac === device.mac ? (
                    <ActivityIndicator size="small" color="#1db954" />
                  ) : (
                    <Pressable
                      style={[styles.smallBtn, styles.btnGreen]}
                      onPress={() => handleBtConnect(device.mac)}
                      accessibilityLabel={`Connect ${device.name}`}
                    >
                      <Text style={styles.smallBtnText}>Connect</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* ── Scan for new speakers ────────────────────────────────────────── */}
        {isReachable && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>Add New Speaker</Text>
              {scanning && <ActivityIndicator size="small" color="#1db954" />}
            </View>

            {/* New (unpaired) devices found in scan */}
            {newDevices.length > 0 && (
              <>
                <Text style={[styles.sectionHeader, { marginTop: 4 }]}>Discovered</Text>
                {newDevices.map(device => (
                  <View key={device.mac} style={styles.card}>
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Icon name="bluetooth" size={22} color="#aaa" />
                        <View style={styles.labelStack}>
                          <Text style={styles.deviceName}>{device.name}</Text>
                          <Text style={styles.deviceSub}>{device.mac}</Text>
                        </View>
                      </View>

                      {pairingMac === device.mac ? (
                        <ActivityIndicator size="small" color="#f39c12" />
                      ) : (
                        <Pressable
                          style={[styles.smallBtn, styles.btnParty]}
                          onPress={() => handlePair(device.mac)}
                          accessibilityLabel={`Pair ${device.name}`}
                        >
                          <Text style={styles.smallBtnText}>Pair</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Already-paired devices shown in scan results (info only) */}
            {discoveredDevices.some(d => d.paired) && (
              discoveredDevices
                .filter(d => d.paired)
                .map(device => (
                  <View key={`already-${device.mac}`} style={[styles.card, { opacity: 0.5 }]}>
                    <View style={styles.row}>
                      <View style={styles.rowLeft}>
                        <Icon name="bluetooth-connected" size={22} color="#1db954" />
                        <View style={styles.labelStack}>
                          <Text style={styles.deviceName}>{device.name}</Text>
                          <Text style={styles.deviceSub}>Already paired</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                ))
            )}
          </View>
        )}

        {/* Offline state */}
        {!isReachable && (
          <View style={styles.emptyState}>
            <Icon name="wifi-off" size={40} color="#555" />
            <Text style={styles.emptyText}>Bridge offline</Text>
            <Text style={styles.emptyHint}>Connect to the same network as the bridge</Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#121212' },

  errorBanner: {
    backgroundColor: '#5c1a1a',
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 8,
    padding: 12,
  },
  errorBannerText: { color: '#ff6b6b', fontSize: 13 },

  section: { paddingHorizontal: 16, paddingTop: 20 },

  sectionHeader: {
    color: '#aaa',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },

  card: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },

  labelStack: { flex: 1 },

  deviceName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  deviceSub:  { color: '#888', fontSize: 12, marginTop: 2 },
  mutedText:  { color: '#555' },

  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  pillGreen: { backgroundColor: '#1db95420' },
  pillRed:   { backgroundColor: '#e74c3c20' },
  pillText:  { fontSize: 12, fontWeight: '600', color: '#fff' },

  actionBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },

  smallBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  smallBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  btnGreen:    { backgroundColor: '#1db954' },
  btnDanger:   { backgroundColor: '#c0392b' },
  btnParty:    { backgroundColor: '#f39c12' },
  btnOffline:  { backgroundColor: '#5b9cf6' },
  btnDisabled: { backgroundColor: '#444' },

  // ── Party ───────────────────────────────────────────────────────────────────
  partyControlCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f39c1230',
  },

  offlineActiveCard: {
    borderColor: '#5b9cf640',
  },

  groupVolumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 4,
  },
  groupSlider: { flex: 1 },
  groupVolLabel: { color: '#aaa', fontSize: 12, minWidth: 36, textAlign: 'right' },

  partyMemberCard: {
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 6,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#f39c12',
  },

  partyMemberTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  partyMemberInfo: { flex: 1 },

  volumeLabel: { color: '#aaa', fontSize: 12, minWidth: 42, textAlign: 'right' },

  slider: { width: '100%', height: 36 },

  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 8,
  },
  syncLabel: { color: '#555', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 },
  syncBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
  },
  syncBtnText: { color: '#aaa', fontSize: 12 },
  syncValue: { color: '#f39c12', fontSize: 12, fontWeight: '600', minWidth: 48, textAlign: 'center' },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: '#f39c12',
    borderColor: '#f39c12',
  },

  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  emptyState: { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText:  { color: '#aaa', fontSize: 15 },
  emptyHint:  { color: '#555', fontSize: 13 },
});
