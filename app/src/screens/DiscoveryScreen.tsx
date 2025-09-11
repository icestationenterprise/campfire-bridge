import React, { useEffect, useState } from 'react';
import { View, Text, Button, TextInput, FlatList, StyleSheet } from 'react-native';
import Zeroconf from 'react-native-zeroconf';

interface Service {
name: string;
host: string;
port: number;
addresses: string[];
}

export default function DiscoveryScreen({ navigation }: any) {
const [ip, setIp] = useState('');
const [services, setServices] = useState<Service[]>([]);

useEffect(() => {
const zeroconf = new Zeroconf();
zeroconf.scan('_campfirebridge._tcp.', 'local.');
zeroconf.on('resolved', (service: Service) => {
setServices(prev => [...prev, service]);
});
return () => zeroconf.stop();
}, []);

const connectToService = (service: Service) => {
// Connect to the service
navigation.navigate('NowPlaying');
};

const connectManually = () => {
// Connect to manual IP
navigation.navigate('NowPlaying');
};

return (
<View style={styles.container}>
<Text style={styles.title}>Select Bridge</Text>
<FlatList
data={services}
keyExtractor={(item) => item.name}
renderItem={({ item }) => (
<Button
title={item.name}
onPress={() => connectToService(item)}
/>
)}
/>
<TextInput
style={styles.input}
placeholder="Or enter IP manually"
value={ip}
onChangeText={setIp}
/>
<Button title="Connect" onPress={connectManually} />
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
input: {
borderWidth: 1,
borderColor: '#ccc',
padding: 10,
marginBottom: 10,
borderRadius: 5,
},
});
