const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.json());

let token = 'dev-token';
let volume = 50;

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });
  return res.json({ token });
});

app.get('/api/status', (req, res) => {
  res.json({ running: true, ts: Date.now(), volume });
});

app.post('/api/volume', (req, res) => {
  volume = Math.max(0, Math.min(100, Number(req.body?.level ?? 0)));
  broadcast({ type: 'status', payload: { running: true, ts: Date.now(), volume } });
  res.json({ ok: true, volume });
});

app.post('/api/command', (req, res) => {
  res.json({ ok: true, echo: req.body });
});

app.get('/', (_, res) => res.send('mock bridge ok'));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'status', payload: { running: true, ts: Date.now(), volume } }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mock bridge listening on ${PORT}`));
