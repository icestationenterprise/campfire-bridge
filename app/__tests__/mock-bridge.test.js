/**
 * Integration tests for mock-bridge.js
 * Spins up the actual express app and hits it with real HTTP requests.
 */

const request = require('supertest');
const app     = require('../mock-bridge');

describe('Mock Bridge API', () => {

  // ── Status ────────────────────────────────────────────────────────────────

  describe('GET /api/status', () => {
    it('returns 200 with the bridge status shape', async () => {
      const res = await request(app).get('/api/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('device');
      expect(res.body).toHaveProperty('connected');
      expect(res.body).toHaveProperty('playing');
      expect(res.body).toHaveProperty('track');
      expect(res.body).toHaveProperty('volume');
    });

    it('track has the expected fields', async () => {
      const res = await request(app).get('/api/status');
      const { track } = res.body;
      expect(track).toHaveProperty('title');
      expect(track).toHaveProperty('artist');
      expect(track).toHaveProperty('position_ms');
      expect(track).toHaveProperty('duration_ms');
    });
  });

  // ── Playback controls ─────────────────────────────────────────────────────

  describe('POST /api/play', () => {
    it('returns 200 and sets playing=true', async () => {
      const res = await request(app).post('/api/play');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.status.playing).toBe(true);
    });
  });

  describe('POST /api/pause', () => {
    it('returns 200 and sets playing=false', async () => {
      // play first
      await request(app).post('/api/play');
      const res = await request(app).post('/api/pause');
      expect(res.status).toBe(200);
      expect(res.body.status.playing).toBe(false);
    });
  });

  describe('POST /api/next', () => {
    it('changes the track and starts playing', async () => {
      const res = await request(app).post('/api/next');
      expect(res.status).toBe(200);
      expect(res.body.status.playing).toBe(true);
      expect(res.body.status.track.title).toBe('Next Track');
    });
  });

  describe('POST /api/previous', () => {
    it('changes the track and starts playing', async () => {
      const res = await request(app).post('/api/previous');
      expect(res.status).toBe(200);
      expect(res.body.status.playing).toBe(true);
      expect(res.body.status.track.title).toBe('Previous Track');
    });
  });

  describe('POST /api/seek', () => {
    it('sets position_ms to the given value', async () => {
      const res = await request(app).post('/api/seek').send({ position_ms: 60000 });
      expect(res.status).toBe(200);
      expect(res.body.status.track.position_ms).toBe(60000);
    });

    it('clamps position_ms to track duration', async () => {
      const res = await request(app).post('/api/seek').send({ position_ms: 999999999 });
      expect(res.status).toBe(200);
      const { position_ms, duration_ms } = res.body.status.track;
      expect(position_ms).toBeLessThanOrEqual(duration_ms);
    });

    it('returns 400 when position_ms is missing', async () => {
      const res = await request(app).post('/api/seek').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/volume', () => {
    it('sets volume to the given value', async () => {
      const res = await request(app).post('/api/volume').send({ volume: 80 });
      expect(res.status).toBe(200);
      expect(res.body.status.volume).toBe(80);
    });

    it('clamps volume to 0–100', async () => {
      const res = await request(app).post('/api/volume').send({ volume: 150 });
      expect(res.body.status.volume).toBe(100);

      const res2 = await request(app).post('/api/volume').send({ volume: -10 });
      expect(res2.body.status.volume).toBe(0);
    });

    it('returns 400 when volume is missing', async () => {
      const res = await request(app).post('/api/volume').send({});
      expect(res.status).toBe(400);
    });
  });

  // ── Bridge connect/disconnect ─────────────────────────────────────────────

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
    });
  });

  // ── Bluetooth devices ─────────────────────────────────────────────────────

  describe('GET /api/bt/devices', () => {
    it('returns a list of devices', async () => {
      const res = await request(app).get('/api/bt/devices');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.devices)).toBe(true);
      expect(res.body.devices.length).toBeGreaterThan(0);
    });

    it('each device has mac, name, and connected fields', async () => {
      const res = await request(app).get('/api/bt/devices');
      const device = res.body.devices[0];
      expect(device).toHaveProperty('mac');
      expect(device).toHaveProperty('name');
      expect(device).toHaveProperty('connected');
    });
  });

  describe('POST /api/bt/connect', () => {
    it('marks a device as connected', async () => {
      // Get the first disconnected device
      const devRes = await request(app).get('/api/bt/devices');
      const disconnected = devRes.body.devices.find((d) => !d.connected);
      if (!disconnected) return; // skip if all already connected

      const res = await request(app).post('/api/bt/connect').send({ mac: disconnected.mac });
      expect(res.status).toBe(200);
      expect(res.body.device.connected).toBe(true);
    });

    it('returns 404 for unknown MAC', async () => {
      const res = await request(app).post('/api/bt/connect').send({ mac: 'FF:FF:FF:FF:FF:FF' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/bt/disconnect', () => {
    it('marks a device as disconnected', async () => {
      // Get the first connected device
      const devRes = await request(app).get('/api/bt/devices');
      const connected = devRes.body.devices.find((d) => d.connected);
      if (!connected) return;

      const res = await request(app).post('/api/bt/disconnect').send({ mac: connected.mac });
      expect(res.status).toBe(200);
      expect(res.body.device.connected).toBe(false);
    });
  });
});
