/**
 * Bridge API integration tests.
 * All system commands (bluetoothctl, party, airplay) are mocked
 * so these run on any machine without real hardware.
 */

import request from 'supertest';

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
  scanDevices:      jest.fn().mockResolvedValue([
    { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', paired: true },
    { mac: 'AA:BB:CC:DD:EE:03', name: 'Patio Speaker',       paired: false },
  ]),
}));

// ── Mock party ────────────────────────────────────────────────────────────────
jest.mock('../src/party', () => ({
  enablePartyMode:   jest.fn().mockResolvedValue(undefined),
  disablePartyMode:  jest.fn().mockResolvedValue(undefined),
  addSpeakerToParty: jest.fn().mockResolvedValue(undefined),
  setSpeakerVolume:  jest.fn().mockResolvedValue(undefined),
  setSpeakerMuted:   jest.fn().mockResolvedValue(undefined),
  setGroupVolume:    jest.fn().mockResolvedValue(undefined),
  shiftGroupVolume:  jest.fn().mockResolvedValue(undefined),
  setGroupMuted:     jest.fn().mockResolvedValue(undefined),
  setDefaultAudioSink: jest.fn().mockResolvedValue(undefined),
  getPartyStatus:    jest.fn().mockReturnValue({ active: false, speakers: [] }),
}));

// ── Mock airplay ──────────────────────────────────────────────────────────────
jest.mock('../src/airplay', () => ({
  startAirplay: jest.fn().mockResolvedValue(undefined),
  stopAirplay:  jest.fn().mockResolvedValue(undefined),
}));

// ── Mock adapters ─────────────────────────────────────────────────────────────
jest.mock('../src/adapters', () => ({
  connectDevice:        jest.fn().mockResolvedValue(undefined),
  disconnectDevice:     jest.fn().mockResolvedValue(undefined),
  pairDevice:           jest.fn().mockResolvedValue(undefined),
  removeDevice:         jest.fn().mockResolvedValue(undefined),
  rehydrateAssignments: jest.fn().mockResolvedValue(undefined),
  getStatus:            jest.fn().mockResolvedValue([]),
  getAdapterForDevice:  jest.fn().mockReturnValue(null),
}));

// Import AFTER mocks are set up
import app from '../src/index';
import * as bluetooth from '../src/bluetooth';
import * as party from '../src/party';
import * as airplay from '../src/airplay';
import * as adapters from '../src/adapters';

// ── Status ────────────────────────────────────────────────────────────────────

describe('GET /api/status', () => {
  it('returns 200 with correct shape', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('device');
    expect(res.body).toHaveProperty('party');
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
  it('calls adapters.connectDevice with the given mac', async () => {
    const res = await request(app)
      .post('/api/bt/connect')
      .send({ mac: 'AA:BB:CC:DD:EE:02' });
    expect(res.status).toBe(200);
    expect(adapters.connectDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
  });

  it('auto-adds speaker to party when party is active', async () => {
    (party.getPartyStatus as jest.Mock).mockReturnValueOnce({
      active: true, speakers: [{ mac: 'AA:BB:CC:DD:EE:01', volume: 80, muted: false }],
    });
    await request(app).post('/api/bt/connect').send({ mac: 'AA:BB:CC:DD:EE:02' });
    expect(party.addSpeakerToParty).toHaveBeenCalledWith('AA:BB:CC:DD:EE:02');
  });

  it('returns 400 when mac is missing', async () => {
    const res = await request(app).post('/api/bt/connect').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bt/disconnect', () => {
  it('calls adapters.disconnectDevice with the given mac', async () => {
    const res = await request(app)
      .post('/api/bt/disconnect')
      .send({ mac: 'AA:BB:CC:DD:EE:01' });
    expect(res.status).toBe(200);
    expect(adapters.disconnectDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01');
  });

  it('returns 400 when mac is missing', async () => {
    const res = await request(app).post('/api/bt/disconnect').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/bt/scan', () => {
  it('returns discovered devices including unpaired ones', async () => {
    const res = await request(app).post('/api/bt/scan');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices).toHaveLength(2);
    const unpaired = res.body.devices.find((d: { paired: boolean }) => !d.paired);
    expect(unpaired).toBeDefined();
    expect(unpaired.name).toBe('Patio Speaker');
  });
});

describe('POST /api/bt/pair', () => {
  it('calls adapters.pairDevice with the given mac', async () => {
    const res = await request(app).post('/api/bt/pair').send({ mac: 'AA:BB:CC:DD:EE:03' });
    expect(res.status).toBe(200);
    expect(adapters.pairDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:03');
  });

  it('returns 400 when mac is missing', async () => {
    const res = await request(app).post('/api/bt/pair').send({});
    expect(res.status).toBe(400);
  });
});

// ── Party mode + AirPlay ───────────────────────────────────────────────────────

describe('GET /api/party', () => {
  it('returns party status', async () => {
    const res = await request(app).get('/api/party');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('active');
    expect(Array.isArray(res.body.speakers)).toBe(true);
  });
});

describe('POST /api/party/enable', () => {
  it('calls party.enablePartyMode and starts AirPlay', async () => {
    (party.getPartyStatus as jest.Mock).mockReturnValueOnce({
      active: true,
      speakers: [
        { mac: 'AA:BB:CC:DD:EE:01', volume: 80, muted: false },
        { mac: 'AA:BB:CC:DD:EE:02', volume: 80, muted: false },
      ],
    });
    const res = await request(app)
      .post('/api/party/enable')
      .send({ macs: ['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02'] });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.party.active).toBe(true);
    expect(party.enablePartyMode).toHaveBeenCalledWith([
      'AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:02',
    ]);
    expect(airplay.startAirplay).toHaveBeenCalled();
  });

  it('returns 400 when macs is missing', async () => {
    expect((await request(app).post('/api/party/enable').send({})).status).toBe(400);
  });

  it('returns 400 when macs is empty array', async () => {
    expect((await request(app).post('/api/party/enable').send({ macs: [] })).status).toBe(400);
  });
});

describe('POST /api/party/disable', () => {
  it('stops AirPlay, calls party.disablePartyMode, and returns active=false', async () => {
    const res = await request(app).post('/api/party/disable');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.party.active).toBe(false);
    expect(airplay.stopAirplay).toHaveBeenCalled();
    expect(party.disablePartyMode).toHaveBeenCalled();
  });
});

describe('POST /api/party/speaker/volume', () => {
  it('calls party.setSpeakerVolume', async () => {
    const res = await request(app)
      .post('/api/party/speaker/volume')
      .send({ mac: 'AA:BB:CC:DD:EE:01', volume: 65 });
    expect(res.status).toBe(200);
    expect(party.setSpeakerVolume).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01', 65);
  });

  it('returns 400 when mac or volume is missing', async () => {
    expect((await request(app).post('/api/party/speaker/volume').send({ mac: 'XX' })).status).toBe(400);
    expect((await request(app).post('/api/party/speaker/volume').send({ volume: 50 })).status).toBe(400);
  });
});

describe('POST /api/party/speaker/mute', () => {
  it('calls party.setSpeakerMuted with muted=true', async () => {
    const res = await request(app)
      .post('/api/party/speaker/mute')
      .send({ mac: 'AA:BB:CC:DD:EE:01', muted: true });
    expect(res.status).toBe(200);
    expect(party.setSpeakerMuted).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01', true);
  });

  it('returns 400 when mac or muted is missing', async () => {
    expect((await request(app).post('/api/party/speaker/mute').send({ mac: 'XX' })).status).toBe(400);
  });
});

describe('POST /api/party/volume', () => {
  it('calls party.setGroupVolume', async () => {
    const res = await request(app).post('/api/party/volume').send({ volume: 70 });
    expect(res.status).toBe(200);
    expect(party.setGroupVolume).toHaveBeenCalledWith(70);
  });

  it('returns 400 when volume is missing', async () => {
    expect((await request(app).post('/api/party/volume').send({})).status).toBe(400);
  });
});

describe('POST /api/party/volume/shift', () => {
  it('calls party.shiftGroupVolume with delta', async () => {
    const res = await request(app).post('/api/party/volume/shift').send({ delta: 10 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(party.shiftGroupVolume).toHaveBeenCalledWith(10);
  });

  it('accepts negative delta', async () => {
    const res = await request(app).post('/api/party/volume/shift').send({ delta: -10 });
    expect(res.status).toBe(200);
    expect(party.shiftGroupVolume).toHaveBeenCalledWith(-10);
  });

  it('returns 400 when delta is missing', async () => {
    expect((await request(app).post('/api/party/volume/shift').send({})).status).toBe(400);
  });
});

describe('POST /api/party/mute', () => {
  it('calls party.setGroupMuted with muted=true', async () => {
    const res = await request(app).post('/api/party/mute').send({ muted: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(party.setGroupMuted).toHaveBeenCalledWith(true);
  });

  it('calls party.setGroupMuted with muted=false', async () => {
    const res = await request(app).post('/api/party/mute').send({ muted: false });
    expect(res.status).toBe(200);
    expect(party.setGroupMuted).toHaveBeenCalledWith(false);
  });

  it('returns 400 when muted is missing', async () => {
    expect((await request(app).post('/api/party/mute').send({})).status).toBe(400);
  });
});

describe('DELETE /api/bt/devices/:mac', () => {
  it('calls adapters.removeDevice with the given mac', async () => {
    const res = await request(app).delete('/api/bt/devices/AA:BB:CC:DD:EE:01');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(adapters.removeDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:01');
  });
});
