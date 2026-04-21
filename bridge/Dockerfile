# Campfire Bridge — development container
# Mimics the Raspberry Pi environment on any machine with Docker.
#
# Usage:
#   docker build -t campfire-bridge .
#   docker run -p 3000:3000 campfire-bridge
#
# The container runs the bridge API with stub versions of librespot,
# playerctl, bluetoothctl, and pactl so you can test the full app without
# real hardware.

FROM debian:bookworm-slim

# ── System deps ───────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    bluez \
    pulseaudio \
    pulseaudio-module-bluetooth \
    playerctl \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 ────────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── Stub binaries (replace real tools with scripts that return fake data) ─────
# Remove these stubs when deploying to a real Pi.

# librespot stub — pretends to start
RUN printf '#!/bin/bash\necho "[librespot-stub] started"\nsleep infinity\n' \
    > /usr/local/bin/librespot && chmod +x /usr/local/bin/librespot

# playerctl stub — returns plausible fake playback state
RUN printf '#!/bin/bash\ncase "$*" in\n\
  *status*)    echo "Playing" ;;\n\
  *position*)  echo "42.5" ;;\n\
  *volume*)    echo "0.50" ;;\n\
  *title*)     echo "Test Song" ;;\n\
  *artist*)    echo "Test Artist" ;;\n\
  *album*)     echo "Test Album" ;;\n\
  *length*)    echo "180000000" ;;\n\
  *)           exit 0 ;;\n\
esac\n' > /usr/local/bin/playerctl && chmod +x /usr/local/bin/playerctl

# bluetoothctl stub — returns two paired speakers and a third undiscovered one
# Handles: paired-devices, devices (scan results), info, connect, disconnect,
#          pair, trust, and the --timeout scan flag.
RUN printf '#!/bin/bash\n\
case "$*" in\n\
  *paired-devices*)\n\
    printf "Device AA:BB:CC:DD:EE:01 Living Room Speaker\\nDevice AA:BB:CC:DD:EE:02 Bedroom Speaker\\n" ;;\n\
  *info*)\n\
    echo "  Connected: yes" ;;\n\
  *connect*)\n\
    echo "Connection successful" ;;\n\
  *disconnect*)\n\
    echo "Successful disconnected" ;;\n\
  *pair*)\n\
    echo "Pairing successful" ;;\n\
  *trust*)\n\
    echo "Changing trust succeeded" ;;\n\
  *scan*|*devices*)\n\
    printf "Device AA:BB:CC:DD:EE:01 Living Room Speaker\\nDevice AA:BB:CC:DD:EE:02 Bedroom Speaker\\nDevice AA:BB:CC:DD:EE:03 Patio Speaker\\n" ;;\n\
  *)\n\
    exit 0 ;;\n\
esac\n' > /usr/local/bin/bluetoothctl && chmod +x /usr/local/bin/bluetoothctl

# pactl stub — simulates PulseAudio combined sink management
RUN printf '#!/bin/bash\n\
case "$*" in\n\
  load-module*)      echo "42" ;;\n\
  unload-module*)    exit 0 ;;\n\
  set-default-sink*) exit 0 ;;\n\
  set-sink-volume*)  exit 0 ;;\n\
  set-sink-mute*)    exit 0 ;;\n\
  "list short sinks")\n\
    printf "0\tbluez_sink.AA_BB_CC_DD_EE_01.a2dp_sink\tMODULE\tRUNNING\\n"\n\
    printf "1\tbluez_sink.AA_BB_CC_DD_EE_02.a2dp_sink\tMODULE\tIDLE\\n" ;;\n\
  *)\n\
    exit 0 ;;\n\
esac\n' > /usr/local/bin/pactl && chmod +x /usr/local/bin/pactl

# ── App ───────────────────────────────────────────────────────────────────────
WORKDIR /app
COPY api/package*.json ./
RUN npm install
COPY api/ .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
