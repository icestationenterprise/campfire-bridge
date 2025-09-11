// Mock server for development
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Mock API endpoints
app.get('/api/health', (req, res) => {
res.json({ status: 'ok' });
});

app.post('/api/login', (req, res) => {
const { pass } = req.body;
if (pass === 'campfire') {
res.json({ token: 'mock-jwt-token' });
} else {
res.status(401).json({ error: 'Unauthorized' });
}
});

app.get('/api/status', (req, res) => {
res.json({
isPlaying: true,
track: {
id: '1',
name: 'Mock Track',
artist: 'Mock Artist',
album: 'Mock Album',
duration_ms: 240000,
progress_ms: 120000
},
device: {
id: 'bridge-1',
name: 'Campfire Bridge',
type: 'speaker'
}
});
});

// WebSocket mock
wss.on('connection', (ws) => {
console.log('Client connected');

// Send mock updates
const interval = setInterval(() => {
ws.send(JSON.stringify({
type: 'status',
data: {
isPlaying: true,
track: {
id: '1',
name: 'Mock Track',
artist: 'Mock Artist',
album: 'Mock Album',
duration_ms: 240000,
progress_ms: Math.floor(Math.random() * 240000)
}
}
}));
}, 5000);

ws.on('close', () => {
clearInterval(interval);
});
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
console.log(Mock server running on port ${PORT});
});
