/**
 * Party-mode graph tests against a fake PulseAudio.
 *
 * The fake tracks loaded modules and sinks the way `pactl` reports them, so
 * these tests pin the behaviour that matters for uninterrupted audio: the null
 * sink is created once, speakers are added/removed/re-timed one loopback at a
 * time, and an existing graph is adopted on startup.
 */

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, readFileSync: jest.fn(() => { throw new Error('no cal'); }), writeFileSync: jest.fn(), mkdirSync: jest.fn() };
});

type Mod = { id: number; name: string; args: string };
const fake = {
  nextId:  10,
  modules: [] as Mod[],
  sinks:   [] as string[],
  calls:   [] as string[],
  reset() { this.nextId = 10; this.modules = []; this.sinks = []; this.calls = []; },
};

jest.mock('../src/pulse', () => {
  const sinkIndex = (name: string) => fake.sinks.indexOf(name) + 1;
  return {
    pactl: jest.fn(async (...args: string[]) => { fake.calls.push(args.join(' ')); return ''; }),
    listSinks: jest.fn(async () => [
      ...fake.sinks.map(name => ({ index: sinkIndex(name), name, driver: 'module-bluez5-device.c' })),
      ...(fake.modules.some(m => m.name === 'module-null-sink') ? [{ index: 99, name: 'campfire_party', driver: 'module-null-sink.c' }] : []),
    ]),
    listModules: jest.fn(async () => fake.modules.map(m => ({ ...m }))),
    listSinkInputs: jest.fn(async () => [
      { index: 7, sink: 1, driver: 'protocol-native.c' },   // shairport-sync on the wrong sink
      { index: 8, sink: 1, driver: 'module-loopback.c' },   // a loopback — must never be moved
    ]),
    sinkLatencies: jest.fn(async () => new Map(fake.sinks.map((s, i) => [s, 100 + i * 50]))),
    loadModule: jest.fn(async (name: string, args: string[]) => {
      const joined = args.join(' ');
      if (name === 'module-loopback') {
        const sink = joined.match(/sink=(\S+)/)![1];
        if (!fake.sinks.includes(sink)) return null;
      }
      const id = fake.nextId++;
      fake.modules.push({ id, name, args: joined });
      fake.calls.push(`load ${name} ${joined}`);
      return id;
    }),
    unloadModule: jest.fn(async (id: number) => {
      fake.modules = fake.modules.filter(m => m.id !== id);
      fake.calls.push(`unload ${id}`);
      return true;
    }),
    getSinkVolume: jest.fn(async () => 65),
    getSinkMute:   jest.fn(async () => false),
  };
});

import * as party from '../src/party';

const A = 'AA:BB:CC:DD:EE:01';
const B = 'AA:BB:CC:DD:EE:02';
const sinkOf = (mac: string) => `bluez_sink.${mac.replace(/:/g, '_')}.a2dp_sink`;
const loopbacks = () => fake.modules.filter(m => m.name === 'module-loopback');
const nullSinks = () => fake.modules.filter(m => m.name === 'module-null-sink');

beforeEach(() => {
  fake.reset();
  party._resetForTests();
  fake.sinks = [sinkOf(A), sinkOf(B)];
});

describe('enablePartyMode', () => {
  it('creates one null sink and one loopback per connected speaker', async () => {
    await party.enablePartyMode([A, B]);
    expect(nullSinks()).toHaveLength(1);
    expect(loopbacks()).toHaveLength(2);
    expect(party.getPartyStatus()).toMatchObject({ active: true });
    expect(party.getPartyStatus().speakers.map(s => s.mac).sort()).toEqual([A, B]);
  });

  it('loopbacks are pinned so a vanished speaker cannot be rescued onto the party sink', async () => {
    await party.enablePartyMode([A]);
    expect(loopbacks()[0].args).toContain('sink_dont_move=true');
    expect(loopbacks()[0].args).toContain('source=campfire_party.monitor');
  });

  it('re-enabling with the same speakers touches nothing', async () => {
    await party.enablePartyMode([A, B]);
    const before = fake.calls.length;
    await party.enablePartyMode([A, B]);
    expect(fake.calls.slice(before).filter(c => /^(load|unload)/.test(c))).toEqual([]);
    expect(nullSinks()).toHaveLength(1);
  });

  it('enabling with a different set adds and removes only the difference', async () => {
    await party.enablePartyMode([A]);
    const sinkId = nullSinks()[0].id;
    await party.enablePartyMode([B]);
    expect(nullSinks()[0].id).toBe(sinkId);                  // the AirPlay sink survived
    expect(loopbacks().map(l => l.args.match(/sink=(\S+)/)![1])).toEqual([sinkOf(B)]);
  });

  it('skips speakers whose sink does not exist and reports only the attached ones', async () => {
    fake.sinks = [sinkOf(A)];
    await party.enablePartyMode([A, B]);
    expect(party.getPartyStatus().speakers.map(s => s.mac)).toEqual([A]);
  });

  it('moves client streams onto the party sink but never loopbacks', async () => {
    await party.enablePartyMode([A]);
    expect(fake.calls).toContain('move-sink-input 7 campfire_party');
    expect(fake.calls).not.toContain('move-sink-input 8 campfire_party');
  });
});

describe('incremental edits', () => {
  it('addSpeakerToParty loads only the new loopback', async () => {
    await party.enablePartyMode([A]);
    const before = fake.calls.length;
    await party.addSpeakerToParty(B);
    const edits = fake.calls.slice(before).filter(c => /^(load|unload)/.test(c));
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatch(/^load module-loopback .*sink=bluez_sink\.AA_BB_CC_DD_EE_02/);
  });

  it('removeSpeakerFromParty unloads only that loopback', async () => {
    await party.enablePartyMode([A, B]);
    await party.removeSpeakerFromParty(A);
    expect(loopbacks()).toHaveLength(1);
    expect(nullSinks()).toHaveLength(1);
    expect(party.getPartyStatus().speakers.map(s => s.mac)).toEqual([B]);
  });

  it('nudgeSpeakerSync rebuilds one loopback with the new latency and keeps the sink', async () => {
    await party.enablePartyMode([A, B]);
    const sinkId = nullSinks()[0].id;
    const otherLoop = loopbacks().find(l => l.args.includes(sinkOf(B)))!.id;
    const originalMs = party.getPartyStatus().speakers.find(s => s.mac === A)!.calibration_ms!;

    await party.nudgeSpeakerSync(A, 40);

    expect(nullSinks()[0].id).toBe(sinkId);
    expect(loopbacks().find(l => l.args.includes(sinkOf(B)))!.id).toBe(otherLoop);
    const loopA = loopbacks().find(l => l.args.includes(sinkOf(A)))!;
    expect(loopA.args).toContain(`latency_msec=${originalMs + 40}`);
    expect(party.getLatencyCalibration()[A]).toBe(originalMs + 40);
  });

  it('Earlier cannot push a speaker below the 50 ms floor', async () => {
    await party.enablePartyMode([A]);
    await party.nudgeSpeakerSync(A, -500);
    expect(party.getLatencyCalibration()[A]).toBe(50);
    expect(loopbacks()[0].args).toContain('latency_msec=50');
  });

  it('remembers a speaker volume across detach and re-attach', async () => {
    await party.enablePartyMode([A, B]);
    await party.setSpeakerVolume(A, 33);
    await party.removeSpeakerFromParty(A);
    await party.addSpeakerToParty(A);
    expect(party.getPartyStatus().speakers.find(s => s.mac === A)!.volume).toBe(33);
    expect(fake.calls.filter(c => c === `set-sink-volume ${sinkOf(A)} 33%`).length).toBeGreaterThanOrEqual(2);
  });
});

describe('disable and adopt', () => {
  it('disablePartyMode unloads everything and restores a real default sink', async () => {
    await party.enablePartyMode([A, B]);
    await party.disablePartyMode();
    expect(fake.modules).toHaveLength(0);
    expect(party.getPartyStatus()).toEqual({ active: false, speakers: [] });
    expect(fake.calls).toContain(`set-default-sink ${sinkOf(A)}`);
  });

  it('adoptExistingGraph takes over a graph left by a previous process', async () => {
    fake.modules = [
      { id: 3, name: 'module-null-sink', args: 'sink_name=campfire_party sink_properties=device.description=CampfireParty' },
      { id: 4, name: 'module-loopback',  args: `source=campfire_party.monitor sink=${sinkOf(A)} latency_msec=210 adjust_time=2` },
      { id: 5, name: 'module-loopback',  args: 'source=something_else.monitor sink=whatever latency_msec=50' },
    ];
    expect(await party.adoptExistingGraph()).toBe(true);
    const status = party.getPartyStatus();
    expect(status.active).toBe(true);
    expect(status.speakers).toEqual([{ mac: A, volume: 65, muted: false, calibration_ms: 210 }]);
    expect(fake.modules).toHaveLength(3);                     // nothing was reloaded
  });

  it('adoptExistingGraph is a no-op when there is nothing to adopt', async () => {
    expect(await party.adoptExistingGraph()).toBe(false);
    expect(party.isActive()).toBe(false);
  });
});

describe('concurrency', () => {
  it('serializes overlapping edits so the graph ends up consistent', async () => {
    await Promise.all([party.enablePartyMode([A]), party.enablePartyMode([A, B]), party.nudgeSpeakerSync(A, 10)]);
    expect(nullSinks()).toHaveLength(1);
    expect(loopbacks()).toHaveLength(2);
  });
});
