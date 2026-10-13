import { parseShortSinks, parseShortModules, parseShortSinkInputs, parseSinkLatencies } from '../src/pulse';

describe('pactl parsers', () => {
  it('parses short sinks', () => {
    const out = '0\talsa_output.usb-Sabrent.analog-stereo\tmodule-alsa-card.c\ts16le 2ch 44100Hz\tIDLE\n' +
                '3\tbluez_sink.18_90_67_7C_60_B0.a2dp_sink\tmodule-bluez5-device.c\ts16le 2ch 44100Hz\tRUNNING\n';
    expect(parseShortSinks(out)).toEqual([
      { index: 0, name: 'alsa_output.usb-Sabrent.analog-stereo', driver: 'module-alsa-card.c' },
      { index: 3, name: 'bluez_sink.18_90_67_7C_60_B0.a2dp_sink', driver: 'module-bluez5-device.c' },
    ]);
  });

  it('parses short modules with arguments', () => {
    const out = '12\tmodule-null-sink\tsink_name=campfire_party sink_properties=device.description=CampfireParty\n' +
                '13\tmodule-loopback\tsource=campfire_party.monitor sink=bluez_sink.X.a2dp_sink latency_msec=300\n' +
                '14\tmodule-bluetooth-discover\t\n';
    const mods = parseShortModules(out);
    expect(mods).toHaveLength(3);
    expect(mods[1]).toEqual({ id: 13, name: 'module-loopback', args: 'source=campfire_party.monitor sink=bluez_sink.X.a2dp_sink latency_msec=300' });
    expect(mods[2].args).toBe('');
  });

  it('parses short sink-inputs with their driver', () => {
    const out = '24\t3\t42\tprotocol-native.c\ts16le 2ch 44100Hz\n25\t3\t-\tmodule-loopback.c\ts16le 2ch 44100Hz\n';
    expect(parseShortSinkInputs(out)).toEqual([
      { index: 24, sink: 3, driver: 'protocol-native.c' },
      { index: 25, sink: 3, driver: 'module-loopback.c' },
    ]);
  });

  it('parses per-sink latency from the long listing', () => {
    const out = [
      'Sink #3', '\tState: RUNNING', '\tName: bluez_sink.18_90_67_7C_60_B0.a2dp_sink',
      '\tLatency: 123456 usec, configured 0 usec',
      'Sink #4', '\tName: campfire_party', '\tLatency: 0 usec, configured 0 usec',
    ].join('\n');
    const m = parseSinkLatencies(out);
    expect(m.get('bluez_sink.18_90_67_7C_60_B0.a2dp_sink')).toBe(124);
    expect(m.get('campfire_party')).toBe(0);
  });
});
