import React from 'react';
import { View, Text, Button, Alert, StyleSheet, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import SamsungSettingsManager from './NativeModules/SamsungSettingsManager';

export default function SamsungSoundAssist() {
const isSamsung = DeviceInfo.getManufacturerSync() === 'Samsung';

const openSettings = async () => {
if (Platform.OS === 'android' && isSamsung) {
try {
await SamsungSettingsManager.openSoundSettings();
} catch (error) {
Alert.alert('Error', 'Could not open Samsung sound settings');
}
} else {
Alert.alert('Not Supported', 'This feature is only available on Samsung devices');
}
};

if (!isSamsung) {
return (
<View style={styles.container}>
<Text style={styles.info}>Samsung Separate App Sound is only available on Samsung devices</Text>
</View>
);
}

return (
<View style={styles.container}>
<Text style={styles.title}>Samsung Sound Assist</Text>
<Text style={styles.description}>
Enable Separate App Sound to route Spotify audio to your Bluetooth speaker
while keeping other app audio on your phone.
</Text>
<Button
title="Open Samsung Sound Settings"
onPress={openSettings}
/>
</View>
);
}

const styles = StyleSheet.create({
container: {
padding: 20,
marginVertical: 20,
backgroundColor: '#f5f5f5',
borderRadius: 10,
},
title: {
fontSize: 18,
fontWeight: 'bold',
marginBottom: 10,
},
description: {
marginBottom: 15,
color: '#666',
},
info: {
fontStyle: 'italic',
color: '#999',
},
});
