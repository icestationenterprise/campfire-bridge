import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useBridge, BluetoothDevice } from '../context/BridgeContext';

export default function DevicesScreen() {
  const {
    status,
    btDevices,
    isReachable,
    baseURL,
    connect,
    disconnect,
    fetchBtDevices,
    connectBtDevice,
    disconnectBtDevice,
  } = useBridge();

  const [loadingMac, setLoadingMac] = useState<string | null>(null);
  const [refreshing,  setRefreshing]  = useState(false);

  // Load BT devices whenever the screen becomes active and bridge is reachable
  useEffect(() => {
    if (isReachable) fetchBtDevices();
  }, [isReachable, fetchBtDevices]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchBtDevices();
    setRefreshing(false);
  };

  const handleBtToggle = async (device: BluetoothDevice) => {
    setLoadingMac(device.mac);
    try {
      if (device.connected) {
        await disconnectBtDevice(device.mac);
      } else {
        await connectBtDevice(device.mac);
      }
    } finally {
      setLoadingMac(null);
    }
  };

  const handleBridgeToggle = async () => {
    try {
      if (status?.connected) {
        await disconnect();
      } else {
        await connect();
      }
    } catch {/* UI will reflect the new state on next poll */}
  };

  return (
    <SafeAreaView style={styles.root}>
      {/* Bridge connection card */}
      <View style={styles.section}>
        <Text style={styles.sectionHeader}>Bridge</Text>
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={styles.cardLeft}>
              <Icon
                name={isReachable ? 'wifi' : 'wifi-off'}
                size={22}
                color={isReachable ? '#1db954' : '#e74c3c'}
              />
              <View style={styles.cardText}>
                <Text style={styles.deviceName}>Campfire Bridge</Text>
                <Text style={styles.deviceSub}>{baseURL}</Text>
              </View>
            </View>
            <View style={[styles.statusPill, isReachable ? styles.pillGreen : styles.pillRed]}>
              <Text style={styles.pillText}>{isReachable ? 'Online' : 'Offline'}</Text>
            </View>
          </View>

          {isReachable && (
            <Pressable
              style={[styles.actionBtn, status?.connected ? styles.btnDanger : styles.btnPrimary]}
              onPress={handleBridgeToggle}
            >
              <Text style={styles.actionBtnText}>
                {status?.connected ? 'Disconnect Bridge' : 'Connect Bridge'}
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Bluetooth devices */}
      <View style={[styles.section, { flex: 1 }]}>
        <Text style={styles.sectionHeader}>Bluetooth Speakers</Text>

        {!isReachable ? (
          <View style={styles.emptyState}>
            <Icon name="bluetooth-disabled" size={40} color="#555" />
            <Text style={styles.emptyText}>Bridge offline — can't list devices</Text>
          </View>
        ) : (
          <FlatList
            data={btDevices}
            keyExtractor={(item) => item.mac}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor="#1db954"
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Icon name="bluetooth-searching" size={40} color="#555" />
                <Text style={styles.emptyText}>No Bluetooth devices found</Text>
                <Text style={styles.emptyHint}>Pull to refresh</Text>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={styles.cardLeft}>
                    <Icon
                      name={item.connected ? 'bluetooth-connected' : 'bluetooth'}
                      size={22}
                      color={item.connected ? '#1db954' : '#aaa'}
                    />
                    <View style={styles.cardText}>
                      <Text style={styles.deviceName}>{item.name}</Text>
                      <Text style={styles.deviceSub}>{item.mac}</Text>
                    </View>
                  </View>

                  {loadingMac === item.mac ? (
                    <ActivityIndicator size="small" color="#1db954" />
                  ) : (
                    <Pressable
                      style={[styles.toggleBtn, item.connected ? styles.btnDanger : styles.btnPrimary]}
                      onPress={() => handleBtToggle(item)}
                      accessibilityLabel={item.connected ? `Disconnect ${item.name}` : `Connect ${item.name}`}
                    >
                      <Text style={styles.toggleBtnText}>
                        {item.connected ? 'Disconnect' : 'Connect'}
                      </Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#121212',
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
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
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  cardText: {
    flex: 1,
  },
  deviceName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  deviceSub: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pillGreen: { backgroundColor: '#1db95420' },
  pillRed:   { backgroundColor: '#e74c3c20' },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  actionBtn: {
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
  },
  toggleBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  btnPrimary: { backgroundColor: '#1db954' },
  btnDanger:  { backgroundColor: '#c0392b' },
  emptyState: {
    alignItems: 'center',
    paddingTop: 48,
    gap: 12,
  },
  emptyText: {
    color: '#aaa',
    fontSize: 15,
  },
  emptyHint: {
    color: '#555',
    fontSize: 13,
  },
});
