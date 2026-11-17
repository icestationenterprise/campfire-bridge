/**
 * Radio power + placement: the rules that put each speaker on its own dongle.
 *
 * BlueZ and bluetoothctl are mocked. The fixtures reproduce the bench state of
 * 2026-11-17: two dongles hot-plugged into the Pi 4B stayed DOWN, the load
 * balancer (which only sees powered radios) had one radio to choose from, and
 * all three speakers bonded to hci2 — audible chopping. The fix is that the
 * bridge powers radios itself before it places anything.
 */

jest.mock('../src/bluez', () => ({
  snapshot:      jest.fn(),
  setPowered:    jest.fn(),
  rfkillUnblock: jest.fn(),
  setTrusted:    jest.fn().mockResolvedValue(true),
  connect:       jest.fn(),
  disconnect:    jest.fn(),
  removeDevice:  jest.fn(),
  devicePath:    jest.requireActual('../src/bluez').devicePath,
}));
jest.mock('../src/btctl', () => ({
  abortAll:   jest.fn(),
  runSession: jest.fn().mockResolvedValue('Pairing successful'),
}));
jest.mock('../src/exec', () => ({
  ...jest.requireActual('../src/exec'),
  delay: jest.fn().mockResolvedValue(undefined),
}));

import * as bluez from '../src/bluez';
import * as btctl from '../src/btctl';
import { ensureAdaptersPowered, pairDevice, connectDevice } from '../src/bluetooth';

const adapter = (n: number, powered: boolean, address: string): bluez.Adapter =>
  ({ hciId: `hci${n}`, path: `/org/bluez/hci${n}`, address, powered, discovering: false, bus: 'usb' });

const bonded = (mac: string, n: number, connected = true): bluez.Device => ({
  address: mac, name: mac,
  path: `/org/bluez/hci${n}/dev_${mac.replace(/:/g, '_')}`, adapterPath: `/org/bluez/hci${n}`, hciId: `hci${n}`,
  paired: true, trusted: true, connected, classOfDevice: 0x240414, addressType: 'public',
});

const JBL = '18:90:67:7C:60:B0', XB23 = '98:52:3D:51:B0:10', THIRD = 'F8:DF:15:DF:53:3B', NEW = 'AA:BB:CC:DD:EE:04';
const A0 = 'E8:CB:F5:A4:5A:D9', A1 = 'E8:CB:F5:A4:5A:4B', A2 = 'E8:CB:F5:A4:5C:DF';

/** The bench: three bonds on hci2; hci0 and hci1 plugged in but DOWN. */
const benchDown = (): bluez.Snapshot => ({
  adapters: [adapter(0, false, A0), adapter(1, false, A1), adapter(2, true, A2)],
  devices:  [bonded(JBL, 2), bonded(XB23, 2), bonded(THIRD, 2)],
});
const benchUp = (): bluez.Snapshot => ({
  ...benchDown(),
  adapters: [adapter(0, true, A0), adapter(1, true, A1), adapter(2, true, A2)],
});

const snapshot   = bluez.snapshot      as jest.Mock;
const setPowered = bluez.setPowered    as jest.Mock;
const unblock    = bluez.rfkillUnblock as jest.Mock;
const runSession = btctl.runSession    as jest.Mock;
const ok  = { ok: true,  stdout: '' };
const bad = (message: string) => ({ ok: false, message });

beforeEach(() => jest.clearAllMocks());

describe('ensureAdaptersPowered', () => {
  it('powers every USB radio that is DOWN and returns the fresh snapshot', async () => {
    snapshot.mockResolvedValueOnce(benchDown()).mockResolvedValue(benchUp());
    setPowered.mockResolvedValue(ok);

    const snap = await ensureAdaptersPowered();

    expect(setPowered).toHaveBeenCalledTimes(2);
    expect(setPowered).toHaveBeenCalledWith('/org/bluez/hci0', true);
    expect(setPowered).toHaveBeenCalledWith('/org/bluez/hci1', true);
    expect(unblock).not.toHaveBeenCalled();
    expect(snap.adapters.every(a => a.powered)).toBe(true);
  });

  it('does nothing, and takes one snapshot, when every radio is already UP', async () => {
    snapshot.mockResolvedValue(benchUp());
    await ensureAdaptersPowered();
    expect(setPowered).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('lifts the rfkill block once and retries when BlueZ names it as the reason', async () => {
    snapshot.mockResolvedValueOnce(benchDown()).mockResolvedValueOnce(benchDown()).mockResolvedValue(benchUp());
    setPowered
      .mockResolvedValueOnce(bad('Blocked through rfkill'))
      .mockResolvedValueOnce(bad('Blocked through rfkill'))
      .mockResolvedValue(ok);
    unblock.mockResolvedValue(ok);

    await ensureAdaptersPowered();

    expect(unblock).toHaveBeenCalledTimes(1);
    expect(setPowered).toHaveBeenCalledTimes(4);          // 2 refused, 2 retried after the unblock
  });

  it('reports but does not throw while a freshly plugged dongle is still initialising', async () => {
    snapshot.mockResolvedValue(benchDown());
    setPowered.mockResolvedValue(bad('Resource Not Ready'));
    await expect(ensureAdaptersPowered()).resolves.toBeDefined();
    expect(unblock).not.toHaveBeenCalled();
  });

  it('does not touch the SoC UART radio while any USB radio exists', async () => {
    const snap = benchDown();
    snap.adapters.push({ ...adapter(3, false, '00:00:00:00:00:03'), bus: 'uart' });
    snapshot.mockResolvedValueOnce(snap).mockResolvedValue(benchUp());
    setPowered.mockResolvedValue(ok);
    await ensureAdaptersPowered();
    expect(setPowered).not.toHaveBeenCalledWith('/org/bluez/hci3', true);
  });
});

describe('pairDevice puts a new speaker on the least-loaded powered radio', () => {
  it('powers the DOWN dongles first, then pairs on an empty one — never on the full hci2', async () => {
    snapshot.mockResolvedValueOnce(benchDown()).mockResolvedValue(benchUp());
    setPowered.mockResolvedValue(ok);

    await pairDevice(NEW);

    expect(setPowered).toHaveBeenCalledTimes(2);
    const [adapterAddress, steps] = runSession.mock.calls[0];
    expect(adapterAddress).toBe(A0);                                     // zero bonds, lowest index
    expect(adapterAddress).not.toBe(A2);
    expect(steps.map((s: { cmd: string }) => s.cmd)).toContain(`pair ${NEW}`);
  });

  it('with every radio UP, picks the empty hci1 over hci0 (one bond) and hci2 (two)', async () => {
    const snap = benchUp();
    snap.devices = [bonded(JBL, 2), bonded(XB23, 2), bonded(THIRD, 0)];
    snapshot.mockResolvedValue(snap);

    await pairDevice(NEW);

    expect(setPowered).not.toHaveBeenCalled();
    expect(runSession.mock.calls[0][0]).toBe(A1);
  });

  it('leaves a speaker alone when every speaker already has its own radio', async () => {
    const snap = benchUp();
    snap.devices = [bonded(JBL, 0), bonded(XB23, 1), bonded(THIRD, 2)];
    snapshot.mockResolvedValue(snap);
    await pairDevice(JBL);
    expect(runSession).not.toHaveBeenCalled();
    expect(bluez.removeDevice).not.toHaveBeenCalled();
  });
});

describe('pairDevice on a speaker that shares a radio = move it (the bench pile-up)', () => {
  it('pairs it on the emptiest radio first, then forgets the old bond', async () => {
    snapshot.mockResolvedValue(benchUp());                               // 3 bonds on hci2, hci0/hci1 empty
    (bluez.disconnect as jest.Mock).mockResolvedValue(ok);
    (bluez.removeDevice as jest.Mock).mockResolvedValue(ok);

    await pairDevice(XB23);

    expect(bluez.disconnect).toHaveBeenCalledWith('/org/bluez/hci2/dev_98_52_3D_51_B0_10');
    expect(runSession.mock.calls[0][0]).toBe(A0);                        // new identity: hci0
    expect(bluez.removeDevice).toHaveBeenCalledWith('/org/bluez/hci2', '/org/bluez/hci2/dev_98_52_3D_51_B0_10');
    // order matters: pair succeeded before the old bond went
    const pairOrder   = runSession.mock.invocationCallOrder[0];
    const removeOrder = (bluez.removeDevice as jest.Mock).mock.invocationCallOrder[0];
    expect(pairOrder).toBeLessThan(removeOrder);
  });

  it('keeps the old bond when the speaker refuses to pair (not in pairing mode)', async () => {
    snapshot.mockResolvedValue(benchUp());
    (bluez.disconnect as jest.Mock).mockResolvedValue(ok);
    runSession.mockResolvedValueOnce('Device 98:52:3D:51:B0:10 not available');

    await expect(pairDevice(XB23)).rejects.toThrow(/pairing mode/i);
    expect(bluez.removeDevice).not.toHaveBeenCalled();
  });

  it('does not shuffle two speakers between two radios that are both occupied', async () => {
    const snap = benchUp();
    snap.devices = [bonded(JBL, 2), bonded(XB23, 2), bonded(THIRD, 0)]; // hci2 ×2, hci0 ×1, hci1 empty
    snapshot.mockResolvedValue(snap);
    (bluez.disconnect as jest.Mock).mockResolvedValue(ok);
    (bluez.removeDevice as jest.Mock).mockResolvedValue(ok);

    await pairDevice(JBL);                                               // should go to hci1 (empty), not hci0
    expect(runSession.mock.calls[0][0]).toBe(A1);

    jest.clearAllMocks();
    snap.devices = [bonded(JBL, 1), bonded(XB23, 2), bonded(THIRD, 0)]; // now one each
    snapshot.mockResolvedValue(snap);
    await pairDevice(XB23);
    expect(runSession).not.toHaveBeenCalled();                           // balanced: nothing to do
  });
});

describe('connectDevice', () => {
  it('powers radios before connecting, so a speaker bonded to a DOWN dongle can come back', async () => {
    const down = benchDown();
    down.devices = [bonded(JBL, 0, false)];                              // bonded on hci0, which is DOWN
    const up = benchUp();
    up.devices = [bonded(JBL, 0, false)];
    snapshot.mockResolvedValueOnce(down).mockResolvedValue(up);
    setPowered.mockResolvedValue(ok);
    (bluez.connect as jest.Mock).mockResolvedValue(ok);

    await connectDevice(JBL);

    expect(setPowered).toHaveBeenCalledWith('/org/bluez/hci0', true);
    expect(bluez.connect).toHaveBeenCalledWith('/org/bluez/hci0/dev_18_90_67_7C_60_B0');
  });
});
