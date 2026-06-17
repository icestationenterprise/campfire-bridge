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
      expect(res.body).toHaveProperty('party');
      expect(res.body.party).toHaveProperty('active');
      expect(res.body.party).toHaveProperty('speakers');
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
      const devRes = await request(app).get('/api/bt/devices');
      const connected = devRes.body.devices.find((d) => d.connected);
      if (!connected) return;

      const res = await request(app).post('/api/bt/disconnect').send({ mac: connected.mac });
      expect(res.status).toBe(200);
      expect(res.body.device.connected).toBe(false);
    });
  });

  // ── Party mode + AirPlay ──────────────────────────────────────────────────

  describe('POST /api/party/enable', () => {
    it('activates the party with the given speakers', async () => {
      const res = await request(app)
        .post('/api/party/enable')
        .send({ macs: ['AA:BB:CC:DD:EE:01'] });
      expect(res.status).toBe(200);
      expect(res.body.party.active).toBe(true);
      expect(res.body.party.speakers).toHaveLength(1);
      expect(res.body.party.speakers[0].mac).toBe('AA:BB:CC:DD:EE:01');
    });

    it('returns 400 when macs is missing', async () => {
      const res = await request(app).post('/api/party/enable').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/party/disable', () => {
    it('deactivates the party', async () => {
      await request(app).post('/api/party/enable').send({ macs: ['AA:BB:CC:DD:EE:01'] });
      const res = await request(app).post('/api/party/disable');
      expect(res.status).toBe(200);
      expect(res.body.party.active).toBe(false);
    });
  });

  describe('POST /api/party/speaker/volume', () => {
    it('sets the speaker volume', async () => {
      await request(app).post('/api/party/enable').send({ macs: ['AA:BB:CC:DD:EE:01'] });
      const res = await request(app)
        .post('/api/party/speaker/volume')
        .send({ mac: 'AA:BB:CC:DD:EE:01', volume: 42 });
      expect(res.status).toBe(200);
      expect(res.body.party.speakers[0].volume).toBe(42);
    });
  });
});
