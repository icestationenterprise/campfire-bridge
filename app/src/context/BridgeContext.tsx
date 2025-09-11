import React, { createContext, useContext, useState, useEffect } from 'react';
import { useBridgeConnection } from '../hooks/useBridgeConnection';

interface BridgeContextType {
isConnected: boolean;
isPlaying: boolean;
track: any;
devices: any[];
connectToDevice: (deviceId: string) => void;
}

const BridgeContext = createContext<BridgeContextType | undefined>(undefined);

export function BridgeProvider({ children }: { children: React.ReactNode }) {
const { isConnected, status } = useBridgeConnection();
const [isPlaying, setIsPlaying] = useState(false);
const [track, setTrack] = useState<any>(null);
const [devices, setDevices] = useState<any[]>([]);

useEffect(() => {
if (status) {
setIsPlaying(status.isPlaying);
setTrack(status.track);
setDevices(status.devices || []);
}
}, [status]);

const connectToDevice = (deviceId: string) => {
// Implement device connection logic
};

return (
<BridgeContext.Provider value={{
isConnected,
isPlaying,
track,
devices,
connectToDevice
}}>
{children}
</BridgeContext.Provider>
);
}

export function useBridge() {
const context = useContext(BridgeContext);
if (context === undefined) {
throw new Error('useBridge must be used within a BridgeProvider');
}
return context;
}
