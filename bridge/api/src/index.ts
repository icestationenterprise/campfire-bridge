import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { exec } from 'child_process';
import { promisify } from 'util';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'default_secret';
const BRIDGE_PASS = process.env.BRIDGE_PASS || 'campfire';

const execAsync = promisify(exec);

// Middleware
app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Auth
app.post('/api/login', (req, res) => {
const { pass } = req.body;
if (pass === BRIDGE_PASS) {
const token = jwt.sign({}, JWT_SECRET, { expiresIn: '1h' });
return res.json({ token });
}
res.status(401).json({ error: 'Unauthorized' });
});

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
const token = req.headers.authorization?.split(' ')[1];
if (!token) return res.status(401).json({ error: 'Missing token' });
try {
jwt.verify(token, JWT_SECRET);
next();
} catch {
res.status(401).json({ error: 'Invalid token' });
}
}

// Routes
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

app.get('/api/status', authenticate, async (_, res) => {
try {
const { stdout } = await execAsync('pactl info');
res.json({ pactl: stdout });
} catch (err) {
res.status(500).json({ error: (err as Error).message });
}
});

app.post('/api/command', authenticate, async (req, res) => {
const { action, ms } = req.body;
try {
switch (action) {
case 'play': await execAsync('pactl play'); break;
case 'pause': await execAsync('pactl pause'); break;
case 'next': await execAsync('pactl next'); break;
case 'prev': await execAsync('pactl previous'); break;
case 'seek': await execAsync(pactl seek ${ms}ms); break;
default: return res.status(400).json({ error: 'Invalid action' });
}
res.json({ success: true });
} catch (err) {
res.status(500).json({ error: (err as Error).message });
}
});

app.post('/api/volume', authenticate, async (req, res) => {
const { level } = req.body;
try {
await execAsync(pactl set-sink-volume @DEFAULT_SINK@ ${level}%);
res.json({ success: true });
} catch (err) {
res.status(500).json({ error: (err as Error).message });
}
});

// WebSocket
wss.on('connection', (ws) => {
ws.send(JSON.stringify({ type: 'status', data: 'connected' }));
});

server.listen(PORT, () => console.log(Bridge API running on port ${PORT}));
