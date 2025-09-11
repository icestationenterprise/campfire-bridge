import { useState, useEffect } from 'react';
import ApiService from '../services/api';
import { useWebSocket } from '../services/websocket';

export function useBridgeConnection() {
const [isConnected, setIsConnected] = useState(false);
const [status, setStatus] = useState<any>(null);
const wsData = useWebSocket();

useEffect(() => {
const checkConnection = async () => {
try {
const status = await ApiService.getStatus();
setStatus(status);
setIsConnected(true);
} catch (error) {
setIsConnected(false);
}
};

checkConnection();
const interval = setInterval(checkConnection, 5000);
return () => clearInterval(interval);
}, []);

useEffect(() => {
if (wsData) {
setStatus(wsData);
}
}, [wsData]);

return { isConnected, status };
}
