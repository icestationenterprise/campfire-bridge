/**
 * Bridge API integration tests.
 * All system commands (playerctl, bluetoothctl, librespot) are mocked
 * so these run on any machine without real hardware.
 */

import request from 'supertest';

// ── Mock playerctl ────────────────────────────────────────────────────────────
jest.mock('../src/playerctl', () => ({
  play:       jest.fn().mockResolvedValue(undefined),
  pause:      jest.fn().mockResolvedValue(undefined),
  next:       jest.fn().mockResolvedValue(undefined),
  previous:   jest.fn().mockResolvedValue(undefined),
  seek:       jest.fn().mockResolvedValue(undefined),
  setVolume:  jest.fn().mockResolvedValue(undefined),
  isPlaying:  jest.fn().mockResolvedValue(false),
  getVolume:  jest.fn().mockResolvedValue(50),
  getPosition: jest.fn().mockResolvedValue(0),
  getTrack:   jest.fn().mockResolvedValue({
    title: 'Test Song', artist: 'Test Artist',
    position_ms: 0, duration_ms: 180000,
  }),
}));

// ── Mock bluetooth ────────────────────────────────────────────────────────────
jest.mock('../src/bluetooth', () => ({
  listDevices: jest.fn().mockResolvedValue([
    { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', connected: true },
    { mac: 'AA:BB:CC:DD:EE:02', name: 'Bedroom Speaker',     connected: false },
  ]),
  connectDevice:    jest.fn().mockResolvedValue(undefined),
  disconnectDevice: jest.fn().mockResolvedValue(undefined),
  trustDevice:      jest.fn().mockResolvedValue(undefined),
  pairDevice:       jest.fn().mockResolvedValue(undefined),
}));

// ── Mock librespot ────────────────────────────────────────────────────────────
jest.mock('../src/librespot', () => ({
  LibrespotManager: jest.fn().mockImplementation(() => ({
    start:     jest.fn(),
    stop:      jest.fn(),
    isRunning: jest.fn().mockReturnValue(true),
  })),
}));

// Import AFTER mocks are set up
import app from '../src/index';
import * as playerctl from '../src/playerctl';
import * as bluetooth from '../src/bluetooth';

// ── Status ────────────────────────────────────────────────────────────────────

describe('GET /api/status', () => {
  it('returns 200 with correct shape', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('device');
    expect(res.body).toHaveProperty('connected');
    expect(res.body).toHaveProperty('playing');
    expect(res.body).toHaveProperty('track');
    expect(res.body).toHaveProperty('volume');
  });

  it('track has required fields', async () => {
    const res = await request(app).get('/api/status');
    expect(res.body.track).toHaveProperty('title');
    expect(res.body.track).toHaveProperty('artist');
    expect(res.body.track).toHaveProperty('position_ms');
    expect(res.body.track).toHaveProperty('duration_ms');
  });
});

// ── Playback ──────────────────────────────────────────────────────────────────

describe('POST /api/play', () => {
  it('calls playerctl.play and sets playing=true', async () => {
    const res = await request(app).post('/api/play');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status.playing).toBe(true);
    expect(playerctl.play).toHaveBeenCalled();
  });
});

describe('POST /api/pause', () => {
  it('calls playerctl.pause and sets playing=false', async () => {
    const res = await request(app).post('/api/pause');
    expect(res.status).toBe(200);
    expect(res.body.status.playing).toBe(false);
    expect(playerctl.pause).toHaveBeenCalled();
  });
});

describe('POST /api/next', () => {
  it('calls playerctl.next', async () => {
    const res = await request(app).post('/api/next');
    expect(res.status).toBe(200);
    expect(playerctl.next).toHaveBeenCalled();
  });
});

describe('POST /api/previous', () => {
  it('calls playerctl.previous', async () => {
    const res = await request(app).post('/api/previous');
    expect(res.status).toBe(200);
    expect(playerctl.previous).toHaveBeenCalled();
  });
});

describe('POST /api/seek', () => {
  it('calls playerctl.seek with position_ms / 1000', async () => {
    const res = await request(app).post('/api/seek').send({ position_ms: 30000 });
    expect(res.status).toBe(200);
    expect(res.body.status.track.position_ms).toBe(30000);
    expect(playerctl.seek).toHaveBeenCalledWith(30000);
  });

  it('returns 400 when position_ms is missing', async () => {
    const res = await request(app).post('/api/seek').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/volume', () => {
  it('calls playerctl.setVolume and clamps to 0–100', async () => {
    const res = await request(app).post('/api/volume').send({ volume: 75 });
    expect(res.status).toBe(200);
    expect(res.body.status.volume).toBe(75);
    expect(playerctl.setVolume).toHaveBeenCalledWith(75);
  });

  it('clamps volume above 100 to 100', async () => {
    const res = await request(app).post('/api/volume').send({ volume: 999 });
    expect(res.body.status.volume).toBe(100);
  });

  it('clamps volume below 0 to 0', async () => {
    const res = await request(app).post('/api/volume').send({ volume: -5 });
    expect(res.body.status.volume).toBe(0);
  });

  it('returns 400 when volume is missing', async () => {
    const res = await request(app).post('/api/volume').send({});
    expect(res.status).toBe(400);
  });
});

// ── Bridge connect/disconnect ─────────────────────────────────────────────────

describe('POST /api/connect', () => {
  it('returns 200 and sets connected=true', async () => {
    const res = await request(app).post('/api/connect');
    expect(res.status).toBe(200);
    expect(res.body.status.connected).toBe(true);
  });
});

describe('POST /api/disconnect', () => {
  it('returns 200 and sets connected=false', async () => {
    const res = await request(app).post('/api/disconnect');
    expect(res.status).toBe(200);
    expect(res.body.status.connected).toBe(false);
    expect(res.body.status.playing).toBe(false);
  });
});

// ── Bluetooth ─────────────────────────────────────────────────────────────────

describe('GET /api/bt/devices', () => {
  it('returns device list from bluetooth.listDevices', async () => {
    const res = await request(app).get('/api/bt/devices');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices).toHaveLength(2);
  });

  it('each device has mac, name, connected', async () => {
    const res = await request(app).get('/api/bt/devices');
    const d = res.body.devices[0];
    expect(d).toHaveProperty('mac');
    expect(d).toHaveProperty('name');
    expect(d).toHaveProperty('connected');
  });
});

describe('POST /api/bt/connect', () => {
  it('calls bluetooth.connectDevice with the given mac', async () => {
    const res = await request(app)
      .post('/api/bt/connect')
      .send({ mac: 'AA:BB:CC:DD:EE:02' });
    expect(res.status).toBe(200);
    expect(bluetooth.connectDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
  });

  it('returns 400 when mac is missing', async () => {
    const res = await request(app).post('/api/bt/connect').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bt/disconnect', () => {
  it('calls bluetooth.disconnectDevice with the given mac', async () => {
    const res = await request(app)
      .post('/api/bt/disconnect')
      .send({ mac: 'AA:BB:CC:DD:EE:01' });
    expect(res.status).toBe(200);
    expect(bluetooth.disconnectDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01');
  });

  it('returns 400 when mac is missing', async () => {
    const res = await request(app).post('/api/bt/disconnect').send({});
    expect(res.status).toBe(400);
  });
});

// ── Internal event hook ───────────────────────────────────────────────────────

describe('POST /internal/event', () => {
  it('playing event sets playing=true and updates track', async () => {
    await request(app).post('/internal/event').send({
      event: 'playing', name: 'New Song', artists: 'New Artist',
      duration_ms: '240000', position_ms: '1000',
    });
    const res = await request(app).get('/api/status');
    expect(res.body.playing).toBe(true);
    expect(res.body.track.title).toBe('New Song');
    expect(res.body.track.artist).toBe('New Artist');
  });

  it('paused event sets playing=false', async () => {
    await request(app).post('/internal/event').send({ event: 'paused' });
    const res = await request(app).get('/api/status');
    expect(res.body.playing).toBe(false);
  });
});
