/**
 * Parser tests for the BlueZ D-Bus snapshot and connect-failure classifier.
 * `verbose` mirrors `busctl --verbose call org.bluez / \
 * org.freedesktop.DBus.ObjectManager GetManagedObjects` on a two-dongle bridge;
 * `fixture` is the same tree already decoded.
 */

import { parseManagedObjects, parseVerboseCall, devicePath } from '../src/bluez';
import { classifyConnectFailure } from '../src/bluetooth';

const v = (_type: string, data: unknown) => data;

const fixture = {
  ...{
    '/org/bluez': { 'org.bluez.AgentManager1': {}, 'org.bluez.ProfileManager1': {} },
    '/org/bluez/hci1': {
      'org.bluez.Adapter1': {
        Address: v('s', '00:1a:7d:da:71:14'), Powered: v('b', true), Discovering: v('b', false),
      },
    },
    '/org/bluez/hci0': {
      'org.bluez.Adapter1': {
        Address: v('s', '00:1A:7D:DA:71:13'), Powered: v('b', true), Discovering: v('b', true),
      },
    },
    '/org/bluez/hci0/dev_18_90_67_7C_60_B0': {
      'org.bluez.Device1': {
        Address: v('s', '18:90:67:7C:60:B0'), Name: v('s', 'JBL Go Essential 2'),
        Paired: v('b', true), Trusted: v('b', true), Connected: v('b', true),
        Adapter: v('o', '/org/bluez/hci0'), Class: v('u', 0x240414), AddressType: v('s', 'public'),
      },
    },
    '/org/bluez/hci1/dev_98_52_3D_51_B0_10': {
      'org.bluez.Device1': {
        Address: v('s', '98:52:3D:51:B0:10'), Alias: v('s', 'SRS-XB23'),
        Paired: v('b', true), Trusted: v('b', true), Connected: v('b', false),
        Adapter: v('o', '/org/bluez/hci1'), Class: v('u', 0x240414), AddressType: v('s', 'public'),
      },
    },
    '/org/bluez/hci1/dev_AA_BB_CC_DD_EE_FF': {
      'org.bluez.Device1': {
        Address: v('s', 'AA:BB:CC:DD:EE:FF'),
        Paired: v('b', false), Trusted: v('b', false), Connected: v('b', false),
        Adapter: v('o', '/org/bluez/hci1'), AddressType: v('s', 'random'),
      },
    },
  },
};

const verbose = `MESSAGE "a{oa{sa{sv}}}" {
        ARRAY "{oa{sa{sv}}}" {
                DICT_ENTRY "oa{sa{sv}}" {
                        OBJECT_PATH "/org/bluez";
                        ARRAY "{sa{sv}}" {
                                DICT_ENTRY "sa{sv}" {
                                        STRING "org.bluez.AgentManager1";
                                        ARRAY "{sv}" {
                                        };
                                };
                        };
                };
                DICT_ENTRY "oa{sa{sv}}" {
                        OBJECT_PATH "/org/bluez/hci0";
                        ARRAY "{sa{sv}}" {
                                DICT_ENTRY "sa{sv}" {
                                        STRING "org.bluez.Adapter1";
                                        ARRAY "{sv}" {
                                                DICT_ENTRY "sv" {
                                                        STRING "Address";
                                                        VARIANT "s" {
                                                                STRING "00:1A:7D:DA:71:13";
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Powered";
                                                        VARIANT "b" {
                                                                BOOLEAN true;
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "UUIDs";
                                                        VARIANT "as" {
                                                                ARRAY "s" {
                                                                        STRING "0000110b-0000-1000-8000-00805f9b34fb";
                                                                };
                                                        };
                                                };
                                        };
                                };
                        };
                };
                DICT_ENTRY "oa{sa{sv}}" {
                        OBJECT_PATH "/org/bluez/hci0/dev_18_90_67_7C_60_B0";
                        ARRAY "{sa{sv}}" {
                                DICT_ENTRY "sa{sv}" {
                                        STRING "org.bluez.Device1";
                                        ARRAY "{sv}" {
                                                DICT_ENTRY "sv" {
                                                        STRING "Address";
                                                        VARIANT "s" {
                                                                STRING "18:90:67:7C:60:B0";
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Name";
                                                        VARIANT "s" {
                                                                STRING "JBL Go "Essential" 2";
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Class";
                                                        VARIANT "u" {
                                                                UINT32 2360340;
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Paired";
                                                        VARIANT "b" {
                                                                BOOLEAN true;
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Connected";
                                                        VARIANT "b" {
                                                                BOOLEAN false;
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "Adapter";
                                                        VARIANT "o" {
                                                                OBJECT_PATH "/org/bluez/hci0";
                                                        };
                                                };
                                                DICT_ENTRY "sv" {
                                                        STRING "ManufacturerData";
                                                        VARIANT "a{qv}" {
                                                                ARRAY "{qv}" {
                                                                        DICT_ENTRY "qv" {
                                                                                UINT16 76;
                                                                                VARIANT "ay" {
                                                                                        ARRAY "y" {
                                                                                                BYTE 16;
                                                                                                BYTE 5;
                                                                                        };
                                                                                };
                                                                        };
                                                                };
                                                        };
                                                };
                                        };
                                };
                        };
                };
        };
};
`;

describe('parseManagedObjects', () => {
  const snap = parseManagedObjects(fixture, hci => (hci === 'hci0' ? 'usb' : 'uart'));

  it('lists adapters sorted by hci index with normalized addresses', () => {
    expect(snap.adapters.map(a => a.hciId)).toEqual(['hci0', 'hci1']);
    expect(snap.adapters[1].address).toBe('00:1A:7D:DA:71:14');
    expect(snap.adapters[0]).toMatchObject({ path: '/org/bluez/hci0', powered: true, discovering: true, bus: 'usb' });
    expect(snap.adapters[1].bus).toBe('uart');
  });

  it('maps each device to the adapter BlueZ reports it under', () => {
    const jbl = snap.devices.find(d => d.address === '18:90:67:7C:60:B0')!;
    expect(jbl).toMatchObject({ name: 'JBL Go Essential 2', hciId: 'hci0', paired: true, connected: true, classOfDevice: 0x240414 });
    const xb23 = snap.devices.find(d => d.address === '98:52:3D:51:B0:10')!;
    expect(xb23).toMatchObject({ name: 'SRS-XB23', hciId: 'hci1', paired: true, connected: false });
  });

  it('falls back to the address when a device has no name or alias', () => {
    const unnamed = snap.devices.find(d => d.address === 'AA:BB:CC:DD:EE:FF')!;
    expect(unnamed.name).toBe('AA:BB:CC:DD:EE:FF');
    expect(unnamed.classOfDevice).toBeNull();
    expect(unnamed.addressType).toBe('random');
  });

  it('rejects output that is not an ObjectManager reply', () => {
    expect(() => parseManagedObjects(['nope'])).toThrow();
    expect(() => parseManagedObjects(undefined)).toThrow();
  });
});

describe('parseVerboseCall', () => {
  const tree = parseVerboseCall(verbose) as Record<string, Record<string, Record<string, unknown>>>;

  it('decodes the busctl --verbose dump into the ObjectManager dictionary', () => {
    expect(Object.keys(tree)).toEqual(['/org/bluez', '/org/bluez/hci0', '/org/bluez/hci0/dev_18_90_67_7C_60_B0']);
    expect(tree['/org/bluez']['org.bluez.AgentManager1']).toEqual({});
    const adapter = tree['/org/bluez/hci0']['org.bluez.Adapter1'];
    expect(adapter).toMatchObject({ Address: '00:1A:7D:DA:71:13', Powered: true, UUIDs: ['0000110b-0000-1000-8000-00805f9b34fb'] });
  });

  it('survives non-string dictionary keys and embedded quotes', () => {
    const dev = tree['/org/bluez/hci0/dev_18_90_67_7C_60_B0']['org.bluez.Device1'];
    expect(dev.Name).toBe('JBL Go "Essential" 2');
    expect(dev.Class).toBe(2360340);
    expect(dev.ManufacturerData).toEqual({ '76': [16, 5] });
  });

  it('feeds straight into parseManagedObjects', () => {
    const snap = parseManagedObjects(tree, () => 'usb');
    expect(snap.adapters).toEqual([expect.objectContaining({ hciId: 'hci0', address: '00:1A:7D:DA:71:13', powered: true, bus: 'usb' })]);
    expect(snap.devices).toEqual([expect.objectContaining({ address: '18:90:67:7C:60:B0', hciId: 'hci0', paired: true, connected: false, classOfDevice: 2360340 })]);
  });
});

describe('devicePath', () => {
  it('builds the BlueZ object path for a MAC', () => {
    expect(devicePath('/org/bluez/hci1', '18:90:67:7c:60:b0')).toBe('/org/bluez/hci1/dev_18_90_67_7C_60_B0');
  });
});

describe('classifyConnectFailure', () => {
  it.each([
    ['br-connection-page-timeout', 'unreachable'],
    ['Host is down',               'unreachable'],
    ['Connection timed out',       'unreachable'],
    ['br-connection-refused',      'refused'],
    ['Connection refused',         'refused'],
    ['br-connection-key-missing',  'refused'],
    ['br-connection-profile-unavailable', 'profile-unavailable'],
    ['Operation currently not available', 'profile-unavailable'],
    ['In Progress',                'busy'],
    ['Resource Not Ready',         'busy'],
    ["Unknown object '/org/bluez/hci0/dev_AA_BB'", 'not-paired'],
    ['something else entirely',    'unknown'],
  ])('%s → %s', (message, reason) => {
    expect(classifyConnectFailure(message)).toBe(reason);
  });
});
