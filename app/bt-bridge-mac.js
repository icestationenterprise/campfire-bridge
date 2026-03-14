// app/bt-bridge-mac.js
// Node 18+. Requires: brew install blueutil switchaudio-osx ; npm i express cors

const express = require("express");
const cors = require("cors");
const { execFile, exec } = require("child_process");
const { execSync } = require('child_process');
const util = require("util");
const ex = util.promisify(exec);
const exf = util.promisify(execFile);

const PORT = process.env.BRIDGE_PORT || 3000;

// 👉 EDIT THESE TWO so they match your speaker (pair it once in macOS Settings > Bluetooth)
const SPEAKER_NAME = process.env.SPEAKER_NAME || "SRS-XB23";
const SPEAKER_MAC  = process.env.SPEAKER_MAC  || "98-52-3d-51-b0-10"; // or "AA:BB:CC:DD:EE:FF"

let state = {
  device: "Mac Bridge",
  connected: false,
  playing: false,
  track: { title: "—", artist: "—", position_ms: 0, duration_ms: 180000 },
  volume: 60,
  _afplayPid: null
};

// ---- shell helpers ---------------------------------------------------------
async function listOutputs() {
  const { stdout } = await exf("SwitchAudioSource", ["-a", "-t", "output"]);
  return stdout.split("\n").filter(Boolean);
}
async function getCurrentOutput() {
  const { stdout } = await exf("SwitchAudioSource", ["-c", "-t", "output"]);
  return stdout.trim();
}
async function setOutput(name) {
  await exf("SwitchAudioSource", ["-s", name, "-t", "output"]);
}
async function isBtConnected(mac) {
  // blueutil wants colons
  const m = mac.replace(/-/g, ":");
  const { stdout } = await exf("blueutil", ["--is-connected", m]).catch(() => ({ stdout: "0" }));
  return stdout.trim() === "1";
}
async function btConnect(mac) {
  const m = mac.replace(/-/g, ":");
  await exf("blueutil", ["--connect", m]);
}
async function btDisconnect(mac) {
  const m = mac.replace(/-/g, ":");
  await exf("blueutil", ["--disconnect", m]);
}
async function getSystemVolume() {
  const { stdout } = await ex(`osascript -e 'output volume of (get volume settings)'`);
  return Number(stdout.trim());
}
async function setSystemVolume(v) {
  const clamped = Math.max(0, Math.min(100, Number(v)));
  await ex(`osascript -e 'set volume output volume ${clamped}'`);
  state.volume = clamped;
}

// ---- status calculation -----------------------------------------------------
async function computeConnected() {
  const cur = await getCurrentOutput().catch(() => "");
  const a = await isBtConnected(SPEAKER_MAC).catch(() => false);
  return a && cur === SPEAKER_NAME;
}

async function getStatus() {
  state.connected = await computeConnected().catch(() => false);
  state.volume = await getSystemVolume().catch(() => state.volume);
  return state;
}

// ---- audio test (uses macOS system sounds via afplay) -----------------------
function stopAfplay() {
  if (state._afplayPid) {
    try { process.kill(state._afplayPid); } catch {}
    state._afplayPid = null;
  }
}
function playSoundLoop() {
  // tiny loop so you can hear output is routed; replace with your own file if you want
  const p = exec(`afplay /System/Library/Sounds/Pop.aiff`);
  state._afplayPid = p.pid;
  p.on("exit", () => { state._afplayPid = null; if (state.playing) playSoundLoop(); });
}

// ---- server ----------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/status", async (_req, res) => {
  res.json(await getStatus());
});

app.post("/api/connect", async (_req, res) => {
  try {
    // must be paired already in macOS Settings
    await btConnect(SPEAKER_MAC);
    // give Bluetooth a moment to connect, then switch system output
    setTimeout(async () => {
      const outs = await listOutputs();
      if (!outs.find(l => l.includes(SPEAKER_NAME))) {
        console.warn("Speaker not found in outputs:", outs);
      } else {
        await setOutput(SPEAKER_NAME);
      }
    }, 700);

    res.json(await getStatus());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e) });
  }
});

app.post("/api/disconnect", async (_req, res) => {
  try {
    stopAfplay();
    state.playing = false;
    await btDisconnect(SPEAKER_MAC);
    res.json(await getStatus());
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/volume', (req, res) => {
  const { volume } = req.body;                       // 0..100
  execSync(`osascript -e 'set volume output volume ${Math.round(volume)}'`);
  state.volume = Math.round(volume);
  res.json(state);
});

app.post('/api/play', (req, res) => {
  try { execSync(`osascript -e 'tell application "Spotify" to play'`); } catch {}
  state.playing = true;
  res.json(state);
});

app.post('/api/pause', (req, res) => {
  try { execSync(`osascript -e 'tell application "Spotify" to pause'`); } catch {}
  state.playing = false;
  res.json(state);
});

app.listen(PORT, () => {
  console.log(`Mac Bridge listening on http://localhost:${PORT}`);
  console.log(`Target speaker: ${SPEAKER_NAME} (${SPEAKER_MAC})`);
});

const sc = (s) => ex(`osascript -e ${JSON.stringify(s)}`);

// ---- Spotify control aliases (routes BridgeContext expects) -----------------

app.post('/api/next', async (_req, res) => {
  await sc('tell application "Spotify" to next track');
  state.playing = true;
  res.json(await getStatus());
});
app.post('/api/previous', async (_req, res) => {
  await sc('tell application "Spotify" to previous track');
  state.playing = true;
  res.json(await getStatus());
});
app.post('/api/seek', (_req, res) => {
  // AppleScript seek not supported in free Spotify; treat as no-op
  res.json(state);
});

// ---- BT device list (exposes the configured speaker) ----------------------

app.get('/api/bt/devices', async (_req, res) => {
  const connected = await isBtConnected(SPEAKER_MAC).catch(() => false);
  res.json({ devices: [{ mac: SPEAKER_MAC, name: SPEAKER_NAME, connected }] });
});
app.post('/api/bt/connect',    (_req, res) => res.redirect(307, '/api/connect'));
app.post('/api/bt/disconnect', (_req, res) => res.redirect(307, '/api/disconnect'));

// ---- Legacy Spotify routes (kept for reference) ---------------------------
app.post('/api/spotify/toggle', async (_req, res) => {
  await sc('tell application "Spotify" to playpause');
  state.playing = !state.playing;
  res.json(await getStatus());
});
app.post('/api/spotify/next', async (_req, res) => {
  await sc('tell application "Spotify" to next track'); res.json(await getStatus());
});
app.post('/api/spotify/prev', async (_req, res) => {
  await sc('tell application "Spotify" to previous track'); res.json(await getStatus());
});