import axios from 'axios';
import { Device, Track, PlaybackState } from '../types';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:8080 ';

class ApiService {
private token: string | null = null;

async login(pass: string): Promise<string> {
const response = await axios.post(${API_BASE}/api/login, { pass });
this.token = response.data.token;
return this.token;
}

private getAuthHeaders() {
return this.token ? { Authorization: Bearer ${this.token} } : {};
}

async getStatus(): Promise<PlaybackState> {
const response = await axios.get(${API_BASE}/api/status, {
headers: this.getAuthHeaders()
});
return response.data;
}

async sendCommand(action: string, params?: any) {
await axios.post(${API_BASE}/api/command, { action, ...params }, {
headers: this.getAuthHeaders()
});
}

async setVolume(level: number) {
await axios.post(${API_BASE}/api/volume, { level }, {
headers: this.getAuthHeaders()
});
}

async pairBluetoothDevice(mac: string) {
await axios.post(${API_BASE}/api/bt/pair, { mac }, {
headers: this.getAuthHeaders()
});
}

async connectBluetoothDevice(mac: string) {
await axios.post(${API_BASE}/api/bt/connect, { mac }, {
headers: this.getAuthHeaders()
});
}

async disconnectBluetoothDevice(mac: string) {
await axios.post(${API_BASE}/api/bt/disconnect, { mac }, {
headers: this.getAuthHeaders()
});
}

async getBluetoothDevices(): Promise<Device[]> {
const response = await axios.get(${API_BASE}/api/devices, {
headers: this.getAuthHeaders()
});
return response.data;
}
}

export default new ApiService();
