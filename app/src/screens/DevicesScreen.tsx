import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, Button, StyleSheet } from 'react-native';
import { useBridge } from '../context/BridgeContext';

export default function DevicesScreen() {
const { devices, connectToDevice } = useBridge();
const [pairedDevices, setPairedDevices] = useState<any[]>([]);

useEffect(() => {
// Fetch paired devices from bridge
}, []);

const renderItem = ({ item }: any) => (
<View style={styles.deviceItem}>
<Text style={styles.deviceName}>{item.name}</Text>
<Button
title={item.connected ? "Connected" : "Connect"}
onPress={() => connectToDevice(item.id)}
disabled={item.connected}
/>
</View>
);

return (
<View style={styles.container}>
<Text style={styles.title}>Bluetooth Devices</Text>
<FlatList
data={devices}
keyExtractor={(item) => item.id}
renderItem={renderItem}
/>
<Button title="Scan for Devices" onPress={() => {}} />
</View>
);
}

const styles = StyleSheet.create({
container: {
flex: 1,
padding: 20,
},
title: {
fontSize: 24,
fontWeight: 'bold',
marginBottom: 20,
},
deviceItem: {
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'center',
padding: 15,
borderBottomWidth: 1,
borderBottomColor: '#eee',
},
deviceName: {
fontSize: 16,
},
});
