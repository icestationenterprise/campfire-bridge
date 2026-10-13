/**
 * Bridge API integration tests.
 * All system access (BlueZ, PulseAudio, systemctl) is mocked so these run on
 * any machine without hardware. They pin the HTTP contract the app relies on.
 */

import request from 'supertest';

// ── Mock bluetooth ────────────────────────────────────────────────────────────
jest.mock('../src/bluetooth', () => ({
  listDevices: jest.fn().mockResolvedValue([
    { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', connected: true,  adapter: 'hci0' },
    { mac: 'AA:BB:CC:DD:EE:02', name: 'Bedroom Speaker',     connected: false, adapter: 'hci1' },
  ]),
  scanDevices: jest.fn().mockResolvedValue({
    devices: [
      { mac: 'AA:BB:CC:DD:EE:01', name: 'Living Room Speaker', paired: true },
      { mac: 'AA:BB:CC:DD:EE:03', name: 'Patio Speaker',       paired: false },
    ],
    scanned: true,
  }),
  connectDevice:       jest.fn().mockResolvedValue(undefined),
  disconnectDevice:    jest.fn().mockResolvedValue(undefined),
  pairDevice:          jest.fn().mockResolvedValue(undefined),
  removeDevice:        jest.fn().mockResolvedValue(undefined),
  getAdapterStatus:    jest.fn().mockResolvedValue({ adapters: [] }),
  setPartyActiveProbe: jest.fn(),
  // Real class: the connect route uses `instanceof` to decide the response shape.
  ConnectError: jest.requireActual('../src/bluetooth').ConnectError,
}));

// ── Mock party ────────────────────────────────────────────────────────────────
jest.mock('../src/party', () => ({
  BUILTIN_ID:             'builtin',
  isActive:               jest.fn().mockReturnValue(false),
  enablePartyMode:        jest.fn().mockResolvedValue(undefined),
  disablePartyMode:       jest.fn().mockResolvedValue(undefined),
  addSpeakerToParty:      jest.fn().mockResolvedValue(undefined),
  removeSpeakerFromParty: jest.fn().mockResolvedValue(undefined),
  onSpeakerConnected:     jest.fn().mockResolvedValue(undefined),
  nudgeSpeakerSync:       jest.fn().mockResolvedValue(undefined),
  setSpeakerLatency:      jest.fn().mockResolvedValue(undefined),
  setSpeakerVolume:       jest.fn().mockResolvedValue(undefined),
  setSpeakerMuted:        jest.fn().mockResolvedValue(undefined),
  setGroupVolume:         jest.fn().mockResolvedValue(undefined),
  shiftGroupVolume:       jest.fn().mockResolvedValue(undefined),
  setGroupMuted:          jest.fn().mockResolvedValue(undefined),
  getLatencyCalibration:  jest.fn().mockReturnValue({}),
  getPartyStatus:         jest.fn().mockReturnValue({ active: false, speakers: [] }),
}));

// ── Mock airplay ──────────────────────────────────────────────────────────────
jest.mock('../src/airplay', () => ({
  startAirplay: jest.fn().mockResolvedValue(undefined),
  stopAirplay:  jest.fn().mockResolvedValue(undefined),
}));

// ── Mock network ──────────────────────────────────────────────────────────────
jest.mock('../src/network', () => ({
  readNetworkMode:    jest.fn().mockReturnValue('home'),
  requestNetworkMode: jest.fn(),
}));

// Import AFTER mocks are set up
import app from '../src/index';
import * as bluetooth from '../src/bluetooth';
import * as party     from '../src/party';
import * as airplay   from '../src/airplay';
import * as network   from '../src/network';

const MAC1 = 'AA:BB:CC:DD:EE:01';
const MAC2 = 'AA:BB:CC:DD:EE:02';

beforeEach(() => jest.clearAllMocks());

// ── Status ────────────────────────────────────────────────────────────────────

describe('GET /api/status', () => {
  it('returns device, party and network mode', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ party: { active: false, speakers: [] }, network_mode: 'home' });
    expect(res.body).toHaveProperty('device');
  });
});

// ── Bluetooth ─────────────────────────────────────────────────────────────────

describe('GET /api/bt/devices', () => {
  it('returns the paired device list', async () => {
    const res = await request(app).get('/api/bt/devices');
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(2);
    expect(res.body.devices[0]).toMatchObject({ mac: MAC1, name: 'Living Room Speaker', connected: true });
  });

  it('returns 500 with the message when BlueZ is unreachable', async () => {
    (bluetooth.listDevices as jest.Mock).mockRejectedValueOnce(new Error('busctl GetManagedObjects failed'));
    const res = await request(app).get('/api/bt/devices');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/busctl/);
  });
});

describe('POST /api/bt/connect', () => {
  it('connects, then hands the speaker to the audio layer before responding', async () => {
    const res = await request(app).post('/api/bt/connect').send({ mac: MAC2 });
    expect(res.status).toBe(200);
    expect(bluetooth.connectDevice).toHaveBeenCalledWith(MAC2);
    expect(party.onSpeakerConnected).toHaveBeenCalledWith(MAC2);
    expect(res.body).toHaveProperty('party');
  });

  it('returns 502 with an actionable reason when the speaker refuses', async () => {
    const { ConnectError } = jest.requireActual('../src/bluetooth');
    (bluetooth.connectDevice as jest.Mock).mockRejectedValueOnce(
      new ConnectError(MAC2, 'hci0', 'refused', 'br-connection-refused'),
    );
    const res = await request(app).post('/api/bt/connect').send({ mac: MAC2 });
    expect(res.status).toBe(502);
    expect(res.body.reason).toBe('refused');
    expect(res.body.action).toBe('pairing-mode');
    expect(res.body.userMessage).toMatch(/pairing mode/i);
    expect(res.body.error).toMatch(/hci0/);
    expect(party.onSpeakerConnected).not.toHaveBeenCalled();
  });

  it('still returns 500 for non-connect failures', async () => {
    (bluetooth.connectDevice as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const res = await request(app).post('/api/bt/connect').send({ mac: MAC2 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
    expect(res.body.reason).toBeUndefined();
  });

  it('returns 400 when mac is missing or malformed', async () => {
    expect((await request(app).post('/api/bt/connect').send({})).status).toBe(400);
    expect((await request(app).post('/api/bt/connect').send({ mac: 'not-a-mac' })).status).toBe(400);
  });
});

describe('POST /api/bt/disconnect', () => {
  it('drops the speaker from the party before disconnecting the radio', async () => {
    const res = await request(app).post('/api/bt/disconnect').send({ mac: MAC1 });
    expect(res.status).toBe(200);
    expect(party.removeSpeakerFromParty).toHaveBeenCalledWith(MAC1);
    expect(bluetooth.disconnectDevice).toHaveBeenCalledWith(MAC1);
  });

  it('returns 400 when mac is missing', async () => {
    expect((await request(app).post('/api/bt/disconnect').send({})).status).toBe(400);
  });
});

describe('POST /api/bt/scan', () => {
  it('returns discovered devices including unpaired ones', async () => {
    const res = await request(app).post('/api/bt/scan');
    expect(res.status).toBe(200);
    expect(res.body.devices).toHaveLength(2);
    expect(res.body.scanned).toBe(true);
    expect(res.body.devices.find((d: { paired: boolean }) => !d.paired).name).toBe('Patio Speaker');
  });
});

describe('POST /api/bt/pair', () => {
  it('pairs then auto-connects', async () => {
    const res = await request(app).post('/api/bt/pair').send({ mac: 'AA:BB:CC:DD:EE:03' });
    expect(res.status).toBe(200);
    expect(bluetooth.pairDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:03');
    expect(bluetooth.connectDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:03');
  });

  it('reports success even when the auto-connect fails', async () => {
    (bluetooth.connectDevice as jest.Mock).mockRejectedValueOnce(new Error('out of range'));
    const res = await request(app).post('/api/bt/pair').send({ mac: 'AA:BB:CC:DD:EE:03' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 400 when mac is missing', async () => {
    expect((await request(app).post('/api/bt/pair').send({})).status).toBe(400);
  });
});

describe('DELETE /api/bt/devices/:mac', () => {
  it('removes the bond and drops the speaker from the party', async () => {
    const res = await request(app).delete(`/api/bt/devices/${MAC1}`);
    expect(res.status).toBe(200);
    expect(party.removeSpeakerFromParty).toHaveBeenCalledWith(MAC1);
    expect(bluetooth.removeDevice).toHaveBeenCalledWith(MAC1);
  });

  it('rejects a malformed mac', async () => {
    expect((await request(app).delete('/api/bt/devices/nope')).status).toBe(400);
  });
});

describe('GET /api/adapters', () => {
  it('returns adapter status', async () => {
    const res = await request(app).get('/api/adapters');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ adapters: [] });
  });
});

// ── Party mode + AirPlay ──────────────────────────────────────────────────────

describe('GET /api/party', () => {
  it('returns party status', async () => {
    const res = await request(app).get('/api/party');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ active: false, speakers: [] });
  });
});

describe('POST /api/party/enable', () => {
  it('enables the party and starts AirPlay', async () => {
    (party.getPartyStatus as jest.Mock).mockReturnValueOnce({
      active: true, speakers: [{ mac: MAC1, volume: 80, muted: false }, { mac: MAC2, volume: 80, muted: false }],
    });
    const res = await request(app).post('/api/party/enable').send({ macs: [MAC1, MAC2] });
    expect(res.status).toBe(200);
    expect(res.body.party.active).toBe(true);
    expect(party.enablePartyMode).toHaveBeenCalledWith([MAC1, MAC2]);
    expect(airplay.startAirplay).toHaveBeenCalled();
  });

  it('accepts the built-in speaker id', async () => {
    const res = await request(app).post('/api/party/enable').send({ macs: ['builtin', MAC1] });
    expect(res.status).toBe(200);
  });

  it('returns 500 and does not start AirPlay when the sink cannot be created', async () => {
    (party.enablePartyMode as jest.Mock).mockRejectedValueOnce(new Error('Failed to load campfire_party null sink'));
    const res = await request(app).post('/api/party/enable').send({ macs: [MAC1] });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/null sink/);
    expect(airplay.startAirplay).not.toHaveBeenCalled();
  });

  it('returns 400 for a missing, empty or malformed macs list', async () => {
    expect((await request(app).post('/api/party/enable').send({})).status).toBe(400);
    expect((await request(app).post('/api/party/enable').send({ macs: [] })).status).toBe(400);
    expect((await request(app).post('/api/party/enable').send({ macs: ['xx'] })).status).toBe(400);
  });
});

describe('POST /api/party/disable', () => {
  it('stops AirPlay and tears the party down', async () => {
    const res = await request(app).post('/api/party/disable');
    expect(res.status).toBe(200);
    expect(res.body.party.active).toBe(false);
    expect(airplay.stopAirplay).toHaveBeenCalled();
    expect(party.disablePartyMode).toHaveBeenCalled();
  });
});

describe('POST /api/party/speaker/sync', () => {
  it('nudges one speaker and returns calibration + party', async () => {
    const res = await request(app).post('/api/party/speaker/sync').send({ mac: MAC1, delta_ms: -20 });
    expect(res.status).toBe(200);
    expect(party.nudgeSpeakerSync).toHaveBeenCalledWith(MAC1, -20);
    expect(res.body).toHaveProperty('calibration');
    expect(res.body).toHaveProperty('party');
  });

  it('turns a failure into a 500 instead of crashing the process', async () => {
    (party.nudgeSpeakerSync as jest.Mock).mockRejectedValueOnce(new Error('pulse down'));
    const res = await request(app).post('/api/party/speaker/sync').send({ mac: MAC1, delta_ms: 10 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('pulse down');
  });

  it('returns 400 when delta_ms is missing', async () => {
    expect((await request(app).post('/api/party/speaker/sync').send({ mac: MAC1 })).status).toBe(400);
  });

  it('accepts the built-in speaker as a sync target', async () => {
    const res = await request(app).post('/api/party/speaker/sync').send({ mac: 'builtin', delta_ms: 25 });
    expect(res.status).toBe(200);
    expect(party.nudgeSpeakerSync).toHaveBeenCalledWith('builtin', 25);
  });
});

describe('POST /api/party/speaker/latency', () => {
  it('sets an absolute calibration', async () => {
    const res = await request(app).post('/api/party/speaker/latency').send({ mac: MAC1, latency_ms: 250 });
    expect(res.status).toBe(200);
    expect(party.setSpeakerLatency).toHaveBeenCalledWith(MAC1, 250);
  });
});

describe('GET /api/party/calibration', () => {
  it('returns the calibration map', async () => {
    const res = await request(app).get('/api/party/calibration');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });
});

describe('POST /api/party/speaker/volume', () => {
  it('sets one speaker volume', async () => {
    const res = await request(app).post('/api/party/speaker/volume').send({ mac: MAC1, volume: 65 });
    expect(res.status).toBe(200);
    expect(party.setSpeakerVolume).toHaveBeenCalledWith(MAC1, 65);
  });

  it('accepts the built-in speaker', async () => {
    expect((await request(app).post('/api/party/speaker/volume').send({ mac: 'builtin', volume: 40 })).status).toBe(200);
    expect(party.setSpeakerVolume).toHaveBeenCalledWith('builtin', 40);
  });

  it('returns 400 when mac or volume is missing', async () => {
    expect((await request(app).post('/api/party/speaker/volume').send({ mac: MAC1 })).status).toBe(400);
    expect((await request(app).post('/api/party/speaker/volume').send({ volume: 50 })).status).toBe(400);
  });
});

describe('POST /api/party/speaker/mute', () => {
  it('mutes one speaker', async () => {
    const res = await request(app).post('/api/party/speaker/mute').send({ mac: MAC1, muted: true });
    expect(res.status).toBe(200);
    expect(party.setSpeakerMuted).toHaveBeenCalledWith(MAC1, true);
  });

  it('returns 400 when muted is missing', async () => {
    expect((await request(app).post('/api/party/speaker/mute').send({ mac: MAC1 })).status).toBe(400);
  });
});

describe('POST /api/party/volume', () => {
  it('sets the group volume', async () => {
    const res = await request(app).post('/api/party/volume').send({ volume: 70 });
    expect(res.status).toBe(200);
    expect(party.setGroupVolume).toHaveBeenCalledWith(70);
  });

  it('returns 400 when volume is missing', async () => {
    expect((await request(app).post('/api/party/volume').send({})).status).toBe(400);
  });
});

describe('POST /api/party/volume/shift', () => {
  it('shifts by delta, positive or negative', async () => {
    expect((await request(app).post('/api/party/volume/shift').send({ delta: 10 })).status).toBe(200);
    expect((await request(app).post('/api/party/volume/shift').send({ delta: -10 })).status).toBe(200);
    expect(party.shiftGroupVolume).toHaveBeenCalledWith(10);
    expect(party.shiftGroupVolume).toHaveBeenCalledWith(-10);
  });

  it('returns 400 when delta is missing', async () => {
    expect((await request(app).post('/api/party/volume/shift').send({})).status).toBe(400);
  });
});

describe('POST /api/party/mute', () => {
  it('mutes and unmutes the group', async () => {
    expect((await request(app).post('/api/party/mute').send({ muted: true })).status).toBe(200);
    expect((await request(app).post('/api/party/mute').send({ muted: false })).status).toBe(200);
    expect(party.setGroupMuted).toHaveBeenCalledWith(true);
    expect(party.setGroupMuted).toHaveBeenCalledWith(false);
  });

  it('returns 400 when muted is missing', async () => {
    expect((await request(app).post('/api/party/mute').send({})).status).toBe(400);
  });
});

// ── Network mode ──────────────────────────────────────────────────────────────

describe('POST /api/network/mode', () => {
  it('writes a mode request for the camping daemon', async () => {
    const res = await request(app).post('/api/network/mode').send({ mode: 'camping' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, requested: 'camping' });
    expect(network.requestNetworkMode).toHaveBeenCalledWith('camping');
  });

  it('rejects unknown modes', async () => {
    expect((await request(app).post('/api/network/mode').send({ mode: 'space' })).status).toBe(400);
  });
});
