import { useEffect, useState } from 'react';

const WS_BASE = process.env.WS_BASE_URL || 'ws://localhost:8080';

class WebSocketService {
private ws: WebSocket | null = null;
private listeners: (( any) => void)[] = [];

connect() {
this.ws = new WebSocket(${WS_BASE}/ws);

this.ws.onmessage = (event) => {
const data = JSON.parse(event.data);
this.listeners.forEach(listener => listener(data));
};

this.ws.onclose = () => {
// Reconnect after 5 seconds
setTimeout(() => this.connect(), 5000);
};
}

disconnect() {
if (this.ws) {
this.ws.close();
this.ws = null;
}
}

addListener(listener: ( any) => void) {
this.listeners.push(listener);
}

removeListener(listener: ( any) => void) {
this.listeners = this.listeners.filter(l => l !== listener);
}
}

export default new WebSocketService();

// Hook for React components
export function useWebSocket() {
const [data, setData] = useState<any>(null);

useEffect(() => {
const listener = (newData: any) => setData(newData);
WebSocketService.addListener(listener);

if (!WebSocketService['ws']) {
WebSocketService.connect();
}

return () => {
WebSocketService.removeListener(listener);
};
}, []);

return data;
}
