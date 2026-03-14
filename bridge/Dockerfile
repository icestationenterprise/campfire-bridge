# Campfire Bridge — development container
# Mimics the Raspberry Pi environment on any machine with Docker.
#
# Usage:
#   docker build -t campfire-bridge .
#   docker run -p 3000:3000 campfire-bridge
#
# The container runs the bridge API with stub versions of librespot,
# playerctl, and bluetoothctl so you can test the full app without
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
# These let the bridge run and respond correctly without real hardware.
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

# bluetoothctl stub — returns a fake paired speaker
RUN printf '#!/bin/bash\ncase "$*" in\n\
  *paired-devices*) echo "Device AA:BB:CC:DD:EE:FF Test Speaker" ;;\n\
  *info*)           echo "  Connected: yes" ;;\n\
  *connect*)        echo "Connection successful" ;;\n\
  *disconnect*)     echo "Successful disconnected" ;;\n\
  *)                exit 0 ;;\n\
esac\n' > /usr/local/bin/bluetoothctl && chmod +x /usr/local/bin/bluetoothctl

# ── App ───────────────────────────────────────────────────────────────────────
WORKDIR /app
COPY api/package*.json ./
RUN npm install
COPY api/ .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
