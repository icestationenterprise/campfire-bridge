# Campfire Bridge Speaker — Product Roadmap & Launch Plan

> Living document. Update as work progresses. Check boxes as tasks complete.
>
> Status: `[ ]` not started · `[~]` in progress · `[x]` complete

---

## Product Overview

A self-contained wireless speaker product with an embedded Linux board, multiple Bluetooth USB dongles, and an amplifier/DAC built into one enclosure. The device receives audio streamed from a phone via AirPlay (iOS) or Cast (Android) and outputs simultaneously to its built-in speaker and up to 1 or 4 paired external Bluetooth speakers. No cloud account required for playback — the device works on a local network or its own hotspot. Controlled through the Campfire app.

---

## Product SKUs

| SKU | External BT USB Dongles | Total Output Channels |
|---|---|---|
| **Limited** | 1 | Built-in speaker + 1 external BT speaker |
| **Extended** | 4 | Built-in speaker + 4 external BT speakers |

The Pi's built-in Bluetooth adapter is **disabled and unused**. All speaker outputs run through the external USB dongles exclusively.

---

## Audio Architecture

**Removed:** librespot (Spotify Connect) — no longer needed, eliminates Spotify ToS risk  
**Kept:** shairport-sync (AirPlay 2) — iOS audio streaming  
**Added:** Cast receiver — Android audio streaming

**How sound segregation works:**
- Once the phone starts an AirPlay or Cast session, audio is sent to the device and plays there independently
- Phone audio (calls, system sounds, notifications) stays on the phone speaker
- Making a call, scrolling Instagram, switching apps — none of it pauses the music on the device
- Any app that supports AirPlay (iOS) or Cast (Android) works: Apple Music, Spotify, YouTube Music, Tidal, etc.
- Removes dependency on any single music service

**App role shift:** Because AirPlay and Cast handle their own playback transport, the Campfire app becomes a **setup and device management app**, not a playback remote. Playback is controlled through iOS Control Center (AirPlay picker) and Android Cast controls in music apps. The Bridge API playback routes (play/pause/next/etc.) can be removed.

---

## Connectivity Modes

The device switches between three modes automatically:

| Mode | When | How App Connects | Internet Required |
|---|---|---|---|
| **Home** | Device joined to home WiFi, phone on same network | Direct LAN via mDNS | No |
| **Remote** | Device on home WiFi, phone elsewhere | Cloud WebSocket relay | Yes (both sides) |
| **Camping / Offline** | No known WiFi in range, or manually forced | Device creates a `Campfire-XXXX` hotspot; phone joins it; direct LAN | No |

Camping mode is a **launch requirement**, not a v2 feature. This is core to the product identity.

In camping mode:
- Device broadcasts a WiFi hotspot automatically when no known network is found
- Phone joins the hotspot — iOS will still route cellular data normally; Android prompts to confirm
- App discovers device via mDNS on the hotspot network
- AirPlay works over this local connection without internet

---

## Ownership & Access Model

Multiple scenarios are supported from day one:

### Scenarios

| Scenario | How It Works |
|---|---|
| **Normal use** | Owner controls their device from their account |
| **Friend takes over (no ownership change)** | Owner generates a time-limited Controller link/code in the app. Friend redeems it in their Campfire app. They can control playback and BT speakers but cannot rename, transfer, or change settings. Expires after a set duration (default 24h) or when owner revokes. |
| **Phone dies, friend takes over** | Same as above — owner generates controller code before phone dies, or another authorized controller is already set up |
| **Sell/transfer used device** | Owner initiates Transfer in app → generates a one-time transfer token (24h expiry). New owner enters token in their Campfire app. Backend: changes `owner_id`, deletes all existing access records, sends factory-reset signal to device to clear stored WiFi credentials and auth. |
| **Gift a device** | Owner generates a gift code (device doesn't need to be present). Recipient redeems in their app at any time. Same backend effect as transfer. |
| **One account, multiple devices** | All devices appear in a list. Owner can switch active device, rename, manage access per device. |

### Access Roles

| Role | Can do |
|---|---|
| **Owner** | Everything: play, manage BT speakers, rename, grant/revoke access, transfer, delete |
| **Controller** | Play/pause, manage BT speakers; cannot change settings or transfer ownership |

---

## Standard Operating Procedure (Dev Sessions)

### Deploying bridge changes to the Pi

**Terminal 3 — rsync from Mac to Pi**
```bash
rsync -avz --exclude 'node_modules' --exclude 'dist' \
  /Users/icestation/Projects/campfire-bridge/bridge/ \
  pi@campfire-bridge.local:/home/pi/campfire-bridge/bridge/
```

**Terminal 2 — remote build (one-off, no interactive session needed)**
```bash
ssh pi@campfire-bridge.local "cd ~/campfire-bridge/bridge/api && npm install && npm run build"
```

**Terminal 4 — already SSH'd in: restart bridge API**
```bash
systemctl --user restart campfire-bridge
```

> Git push to GitHub is separate from Pi deployment. rsync pushes code directly; git is for version history. Push to GitHub once a task is confirmed working on the Pi.

---

## Current State (What Exists)

| Component | Status | Notes |
|---|---|---|
| shairport-sync (AirPlay 2) | ✅ Done | Runs as user service; starts/stops with party mode |
| PulseAudio + BT stack | ✅ Done | multi-adapter, A2DP auto-recovery on restart |
| Bluetooth scripts (bt_connect, bt_pair, etc.) | ✅ Done | Keep |
| Bridge API (Express/TS) | ✅ Done | BT mgmt + party mode routes; playback routes removed; `network_mode` in `/api/status` |
| librespot | ✅ Removed | Deleted — no longer in codebase |
| SpotifyContext / spotifyAuth | ✅ Removed | Deleted from app |
| React Native app (iOS) | 🔶 Functional | Spotify removed; Home/Camping mode toggle; default Home URL = `http://campfire-bridge.local:3000`; Tailscale removed; auto URL fallback (3-failure → switch mode); migration for old AsyncStorage keys; needs account, setup wizard, device mgmt, ownership |
| Mock bridge server | ✅ Done | Updated to match current API shape |
| mDNS / avahi | ✅ Done | Advertises AirPlay; needs device serial in TXT record |
| camping-mode daemon | 🔶 Partial | `camping-mode.sh` + NM hotspot profile done; auto-switches home↔camping; oscillation bug fixed (45s reconnect wait); `POST /api/network/mode` endpoint done; `network_mode` in `/api/status`; SSID is "Campfire" (not serial-suffixed yet — needs #10); LED/button not done |
| App auto URL detection | ✅ Done | After 3 failures on primary URL, tries fallback; auto-switches mode on success |

---

## Phase 1 — Software Foundation

### 1.1 Bridge Firmware / Device Software

#### Remove librespot
- [ ] Remove librespot systemd service
- [ ] Remove `bridge/config/librespot.env`
- [ ] Remove `bridge/systemd/librespot.service`
- [ ] Remove librespot-related Bridge API routes

#### WiFi Provisioning — BLE Flow (first-boot)
- [ ] Device advertises a `CampfireBridge` BLE service UUID when unconfigured
- [ ] BLE characteristic accepts encrypted SSID + password payload from app
- [ ] On receipt, write WiFi credentials and reboot into home mode
- [ ] Fallback: if BLE provisioning fails, device creates a hotspot; app connects and POSTs credentials via HTTP

#### Camping / Offline Mode
- [ ] `camping-mode.service` — systemd service that monitors for known WiFi networks
- [ ] If no known network found after 60 seconds of boot: switch to AP (hotspot) mode
- [ ] Hotspot SSID: `Campfire-<last4ofserial>`, password printed on device label
- [ ] Physical button: short press toggles camping mode manually
- [ ] LED states: pulsing blue = unconfigured, solid white = home/connected, orange = camping/hotspot, red = error

#### Multi-Dongle Audio Management
- [ ] PulseAudio config: enumerate each USB BT dongle as a separate named sink
- [ ] `GET /api/dongles` — returns list of dongle slots (1 for Limited, 4 for Extended) with paired device info
- [ ] Dongle slot ↔ paired BT speaker mapping persisted to disk
- [ ] On boot, auto-reconnect each dongle to its previously paired speaker

#### Completed Bridge API Routes (device management focus)
- [ ] `GET /api/status` — network mode, dongle slot states, firmware version, uptime
- [ ] `GET /api/bt/devices` — scan for nearby BT speakers
- [ ] `POST /api/bt/pair` `{ slot, mac }` — pair a speaker to a specific dongle slot
- [ ] `POST /api/bt/connect` `{ slot }` — connect slot to its paired speaker
- [ ] `POST /api/bt/disconnect` `{ slot }` — disconnect slot
- [ ] `GET /api/bt/slots` — current state of all dongle slots
- [ ] `POST /api/network/mode` `{ mode: 'home' | 'camping' }` — force mode switch
- [ ] `GET /api/update/status` — current firmware version, available version

#### Device Identity (manufacture-time)
- [ ] Serial number format: `CB-<SKU>-<6-char-alphanum>` (e.g. `CB-EXT-A3F7K2`)
- [ ] At flash time: burn serial + device certificate/key to `/etc/campfire/identity`
- [ ] Device uses cert to authenticate all requests to the cloud backend
- [ ] mDNS advertisement includes device serial in TXT record

#### OTA Update Agent
- [ ] Evaluate: Mender.io (recommended for embedded Linux) vs Balena vs custom poll
- [ ] Device polls `GET /firmware/latest` on startup and every 4 hours
- [ ] Staged rollout: backend can target updates to a serial range or SKU

---

### 1.2 Backend (New — all of this)

**Stack:** Node.js/TypeScript + PostgreSQL  
**Hosting:** Railway or Fly.io (start simple, scale later)

#### Database Schema

```sql
users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
)

devices (
  id UUID PRIMARY KEY,
  serial TEXT UNIQUE NOT NULL,
  sku TEXT NOT NULL,                  -- 'limited' | 'extended'
  owner_id UUID REFERENCES users(id),
  name TEXT,
  firmware_version TEXT,
  last_seen TIMESTAMPTZ,
  cert_fingerprint TEXT,
  network_mode TEXT                   -- 'home' | 'camping' | 'offline'
)

device_access (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES devices(id),
  user_id UUID REFERENCES users(id),
  role TEXT NOT NULL,                 -- 'owner' | 'controller'
  expires_at TIMESTAMPTZ,            -- NULL = permanent (owner), timestamp = temp controller
  created_by UUID REFERENCES users(id)
)

transfer_tokens (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES devices(id),
  token TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,   -- 24h from creation
  used_at TIMESTAMPTZ
)

gift_codes (
  id UUID PRIMARY KEY,
  device_id UUID REFERENCES devices(id),
  code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id),
  redeemed_by UUID REFERENCES users(id),
  redeemed_at TIMESTAMPTZ
)

firmware_releases (
  id UUID PRIMARY KEY,
  version TEXT NOT NULL,
  sku TEXT,                           -- NULL = all SKUs, or 'limited'/'extended'
  url TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  released_at TIMESTAMPTZ DEFAULT now(),
  rollout_pct INT DEFAULT 100        -- staged rollout percentage
)
```

#### Auth Service
- [ ] `POST /auth/register`
- [ ] `POST /auth/login` → JWT
- [ ] `POST /auth/forgot-password` → email with reset link
- [ ] `POST /auth/reset-password`

#### Device Registry
- [ ] `POST /devices/claim` — submit serial from box; backend verifies real unowned device; assigns to account
- [ ] `GET /devices` — list all devices user owns or has controller access to
- [ ] `PATCH /devices/:id` — rename
- [ ] `DELETE /devices/:id` — remove (triggers factory-reset signal to device)

#### Ownership & Access Endpoints
- [ ] `POST /devices/:id/transfer/initiate` — owner generates one-time transfer token (24h expiry)
- [ ] `POST /devices/transfer/redeem` — new owner submits token; backend changes `owner_id`, deletes all `device_access` rows, pushes factory-reset command to device
- [ ] `POST /devices/:id/gift` — generate gift code; device assigned to code, not yet claimed
- [ ] `POST /devices/gift/redeem` — recipient redeems gift code; same effect as transfer
- [ ] `POST /devices/:id/access/grant` — owner grants temporary controller access (by email, or returns shareable token link)
- [ ] `GET /devices/:id/access` — list current access grants
- [ ] `DELETE /devices/:id/access/:userId` — revoke controller access

#### Cloud WebSocket Relay
- [ ] Device maintains persistent WebSocket connection to backend after boot
- [ ] App connects to relay when it cannot reach device directly on LAN
- [ ] App always tries direct LAN (mDNS) first; relay is automatic fallback
- [ ] Relay routes: device commands (BT connect/disconnect, network mode) and status updates
- [ ] Audio stream never passes through the cloud — AirPlay/Cast operate peer-to-peer on the local network
- [ ] Relay is inactive in camping mode (no internet); app connects directly to device's hotspot

#### OTA Server
- [ ] `GET /firmware/latest?sku=extended&current=1.2.3` → `{ version, url, sha256 }` or `{ upToDate: true }`
- [ ] Firmware images stored in Cloudflare R2 or S3

---

### 1.3 Mobile App Changes

#### Remove Spotify-specific code
- [ ] Remove `SpotifyContext.tsx`
- [ ] Remove `SpotifyLoginScreen.tsx`
- [ ] Remove `spotifyAuth.ts`
- [ ] Remove `spotifyClientId` from `SettingsContext.tsx`
- [ ] Remove Music tab's Spotify-specific UI; Music tab becomes AirPlay/Cast instructions or is removed

#### New: Account Screens
- [ ] Sign up (email + password)
- [ ] Log in
- [ ] Forgot / reset password

#### New: Device Setup Wizard (first-run flow)
1. "Power on your Campfire Bridge Speaker — LED pulses blue"
2. App scans BLE for `CampfireBridge` service UUID
3. App connects, sends WiFi SSID + password over encrypted BLE characteristic
4. Device reboots onto home WiFi, LED turns solid white
5. "Enter the serial number from the bottom of your speaker" → `POST /devices/claim`
6. App discovers device on LAN via mDNS, confirms connection
7. "You're set up. Use AirPlay (iOS) or Cast (Android) to start playing music."

#### New: Multi-Device & Ownership Screens
- [ ] Device list (owned + controller access — visually differentiated)
- [ ] Switch active device
- [ ] Rename device
- [ ] Per-device access list (owner view): who has controller access, expiry
- [ ] Grant controller access → generates shareable link/code
- [ ] Revoke controller access
- [ ] Transfer ownership flow (initiate + confirm)
- [ ] Gift device flow
- [ ] Accept transfer / redeem gift flow

#### Settings Screen Updates
- [ ] Remove bridge URL manual entry (replaced by account + device registry)
- [ ] Remove Spotify client ID field
- [ ] Show: current network mode (Home / Remote / Camping)
- [ ] Button: force Camping Mode

#### Android Support
- [ ] BLE provisioning (react-native-ble-manager already installed — needs provisioning flow wired up)
- [ ] Cast SDK integration (Google Cast for React Native)
- [ ] Test BLE provisioning on Android
- [ ] Test Cast session from common Android music apps
- [ ] ⚠️ Known limitation: Cast SDK requires internet for initial session handshake. Android users in camping/offline mode cannot use Cast. Workaround: document limitation; evaluate UPnP/DLNA as offline fallback for Android.

#### App Distribution
- [ ] Apple Developer Program ($99/yr) — submit via App Store Connect
- [ ] Google Play Console ($25 one-time) — submit via Play Console
- [ ] Privacy policy URL (required by both stores)
- [ ] App screenshots for both stores

---

## Phase 2 — Hardware Finalization (run in parallel, 8–16 weeks)

### Bill of Materials

| Component | Limited SKU | Extended SKU | Notes |
|---|---|---|---|
| SBC | Pi 5 (dev) or CM4 (production) | same | CM4 preferred for production — smaller, more reliable |
| External USB BT dongles | 1 | 4 | Must be confirmed compatible with PulseAudio BT sink |
| Powered USB hub | Not needed | Yes | Required for 4 dongles under load |
| DAC / amplifier board | Yes | Yes | Drives built-in speaker |
| Built-in speaker driver | Yes | Yes | Mounted in enclosure |
| Power supply | Sized for load | Sized for load | Extended needs more headroom |
| RGB status LED | Yes | Yes | Provisioning / home / camping / error states |
| Physical button | Yes | Yes | Short: camping toggle. Long: factory reset |
| Enclosure | Custom or modified off-shelf | same | |

### Factory Provisioning Process
- [ ] Serial number generation script (batch N serials by SKU)
- [ ] Pre-load all serials into backend `devices` table before manufacturing (unowned)
- [ ] Per-device TLS certificate generated and burned at flash time
- [ ] Factory firmware image: boots into BLE provisioning mode by default
- [ ] Labels: serial number + QR code linking to app download + setup guide

### Certification
- [ ] **FCC Part 15 (WiFi + BT)** — required before US sales, ~$5–15k, ~6–12 weeks. **Start immediately — this is the critical path.**
- [ ] Using CM4 with its pre-certified radio module simplifies FCC path
- [ ] CE marking (EU) — self-declare is possible if using certified radio modules

---

## Phase 3 — OTA + Distribution (4 weeks)

- [ ] Integrate Mender.io OTA agent into firmware
- [ ] Firmware CI/CD: GitHub Actions → build image → upload to R2/S3 → push to OTA server
- [ ] App CI/CD: GitHub Actions → EAS Build (iOS + Android) → submit
- [ ] Sentry error monitoring (app + backend)

---

## Phase 4 — E-commerce + Fulfillment (2 weeks)

- [ ] Shopify store with Limited and Extended SKU listings
- [ ] Order fulfillment: serial number from pre-provisioned pool printed on box label
- [ ] In-box insert: QR code to App Store / Play Store, serial number label, setup instructions (one page)
- [ ] Full end-to-end test pass: purchase → unbox → setup → play music → camping mode → grant friend access → transfer ownership

---

## Phase 5 — Launch

- [ ] Small batch: 20–50 units
- [ ] Beta with known users
- [ ] Monitor: Sentry crash rate, OTA success rate, BLE provisioning success rate, relay connection stability

---

## Infrastructure

| What | Tool |
|---|---|
| Backend hosting | Railway or Fly.io |
| Database | Managed PostgreSQL (built into Railway/Fly) |
| Firmware + OTA storage | Cloudflare R2 (generous free tier) |
| Domain + SSL | Cloudflare |
| Transactional email | Resend or SendGrid |
| Error monitoring | Sentry |
| App CI/CD | GitHub Actions + EAS Build |
| Firmware CI/CD | GitHub Actions |

---

## Legal / Compliance

| Item | Status | Notes |
|---|---|---|
| Business entity (LLC) | [ ] | Before taking any money |
| Privacy policy | [ ] | Required for both app stores |
| Terms of service | [ ] | Cover warranty, returns, known limitations |
| FCC Part 15 certification | [ ] | **Critical path — start immediately** |
| CE marking (EU) | [ ] | Self-declare if using certified radio modules |
| ~~Spotify ToS~~ | ✅ Resolved | librespot removed; using AirPlay + Cast |

---

## Action Items — Work Order

### Three Reference Points

| | Item | Why |
|---|---|---|
| ⚡ **Quickest Win** | Items #3 + #4: Remove librespot & Spotify code | Pure deletion, ~1 hour total, no prerequisites, eliminates the Spotify legal risk immediately |
| 🕐 **Longest Timeline** | Item #1: FCC Certification | 6–12 weeks external, hard blocks US sales. Must be initiated before any other work begins and runs the entire time development is happening. |
| 🎯 **Most Critical for Functionality** | Items #6–#8: Backend auth + device registry | Every other component — app, firmware, relay, ownership model — plugs into this. Nothing works end-to-end without it. |

---

### Ranked Work Order

Prerequisites always come before the things that need them.
Items with no dependency on each other can be worked in parallel.
When asked "what is next", Claude will present the first three `[ ]` items as options.

- [ ] **#1 — Start FCC certification** — Contact a certified test lab (NTS, SGS, UL). Submit application. Runs 6–12 weeks externally. Blocks US sales. Kick this off before writing any code.
- [ ] **#2 — Form LLC** — Must happen before taking any money. Online filing in most states, same-day possible.
- [x] **#3 — Remove librespot from bridge** *(⚡ quickest win)* — Delete librespot systemd service, `bridge/config/librespot.env`, `bridge/systemd/librespot.service`, librespot API routes. ~30 min.
- [x] **#4 — Remove Spotify code from app** *(⚡ quickest win)* — Delete `SpotifyContext.tsx`, `SpotifyLoginScreen.tsx`, `spotifyAuth.ts`, `spotifyClientId` from SettingsContext, Music tab Spotify UI. ~30 min.
- [ ] **#5 — Infrastructure setup** — Register domain, set up Railway or Fly.io project, Cloudflare DNS + SSL, R2 bucket for firmware storage. Foundation for backend deployment.
- [ ] **#6 — Backend: DB schema + project setup** — Initialize Node/TS project, write migrations for all 6 tables (`users`, `devices`, `device_access`, `transfer_tokens`, `gift_codes`, `firmware_releases`), connect to managed Postgres.
- [ ] **#7 — Backend: Auth service** — `POST /auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` + JWT middleware. Gate for device registry and all app account flows. *(🎯 most critical — start here after infra)*
- [ ] **#8 — Backend: Device registry** — `POST /devices/claim`, `GET /devices`, `PATCH /devices/:id`, `DELETE /devices/:id`. Gate for the first-user setup flow.
- [ ] **#9 — Privacy policy + Terms of Service** — Required for both app stores and for any sales. No code prerequisites; must be complete before app store submission.
- [ ] **#10 — Device firmware: Device identity** — Define serial format (`CB-LTD-XXXXXX` / `CB-EXT-XXXXXX`), write provisioning script that burns serial + TLS cert to `/etc/campfire/identity` at flash time. Must be finalized before factory provisioning jig.
- [ ] **#11 — Device firmware: BLE provisioning service** — Device advertises `CampfireBridge` BLE service UUID when unconfigured; characteristic accepts encrypted WiFi SSID + password; reboots into home mode on receipt. Gate for app setup wizard.
- [ ] **#12 — App: Account screens** — Sign up, log in, forgot/reset password. Requires auth service (#7) to be running.
- [ ] **#13 — App: Device setup wizard** — BLE scan → send WiFi credentials → claim serial via `POST /devices/claim` → mDNS confirm. Requires BLE provisioning (#11) + account screens (#12) + device registry (#8). This is the critical first-user flow.
- [~] **#14 — Device firmware: Hotspot/camping mode** — Systemd service monitors for known WiFi networks; falls back to AP mode after 60s; hotspot SSID `Campfire-<last4serial>`; LED states; physical button toggle. *(camping-mode.sh + NM hotspot profile done; SSID is "Campfire" until device identity #10 is done; LED/button pending)*
- [ ] **#15 — Backend: Cloud WebSocket relay** — Device connects on boot and maintains persistent connection; app falls back to relay when not on LAN; relay routes commands + status only (never audio). Requires device identity (#10) for device authentication.
- [ ] **#16 — Device firmware: Multi-dongle audio management** — PulseAudio config enumerates each USB BT dongle as a named sink; slot↔speaker MAC mapping persisted to `/etc/campfire/slots.json`; auto-reconnect each slot on boot.
- [ ] **#17 — Device firmware: Bridge API routes (device management)** — `GET /api/status`, `GET /api/bt/slots`, `POST /api/bt/pair`, `POST /api/bt/connect`, `POST /api/bt/disconnect`, `POST /api/network/mode`, `GET /api/update/status`. Requires multi-dongle setup (#16).
- [ ] **#18 — App: BT speaker management UI** — DevicesScreen updated for per-slot pairing and connect/disconnect per slot. Requires Bridge API (#17) + setup wizard complete (#13) so app has device URL.
- [ ] **#19 — Backend: Ownership & access endpoints** — Transfer initiate/redeem, gift create/redeem, controller grant/revoke, access list. Requires device registry (#8).
- [ ] **#20 — App: Multi-device & ownership screens** — Device list, rename, access list, grant/revoke controller, transfer flow, gift flow, redeem flow. Requires ownership endpoints (#19) + account screens (#12).
- [ ] **#21 — Backend: OTA server** — Firmware manifest endpoint (`GET /firmware/latest`) + R2 storage for images + staged rollout by serial range. Requires infrastructure (#5).
- [ ] **#22 — Device firmware: OTA update agent** — Poll OTA server on boot and every 4 hours; verify SHA256; apply update and reboot. Requires OTA server (#21).
- [ ] **#23 — Error monitoring (Sentry)** — Add to app and backend. No hard prerequisites; must be in place before beta.
- [ ] **#24 — App CI/CD** — GitHub Actions + EAS Build for iOS + Android. Must be set up before app store submissions.
- [ ] **#25 — App: Android support** — Wire BLE provisioning flow on Android (react-native-ble-manager already installed) + Cast SDK integration. Requires BLE provisioning firmware (#11).
- [ ] **#26 — App: iOS App Store submission** — Requires privacy policy (#9) + CI/CD (#24) + account screens (#12) + setup wizard (#13) + TestFlight beta pass.
- [ ] **#27 — App: Android Google Play submission** — Requires Android support (#25) + privacy policy (#9) + CI/CD (#24).
- [ ] **#28 — Hardware: BOM finalization** — Confirm all components (SBC, dongles, USB hub, DAC/amp, speaker, PSU, LED, button, enclosure) for both SKUs with suppliers and quantities. Runs in parallel with all software work.
- [ ] **#29 — Hardware: Factory provisioning jig + process** — Serial number generation script (batch by SKU), cert generation + flash script, firmware image, label printing. Requires device identity spec (#10) + BOM finalized (#28).
- [ ] **#30 — E-commerce: Shopify store** — Limited + Extended SKU listings, payment processing, shipping. Requires LLC (#2).
- [ ] **#31 — E-commerce: Serial number assignment workflow** — Map order fulfillment → assign serial from pre-loaded pool → print label. Requires device registry (#8) + provisioning jig (#29).
- [ ] **#32 — Full end-to-end test** — Purchase → unbox → setup → play music → camping mode → grant friend controller → transfer ownership. Every item above must be complete.
- [ ] **#33 — Beta launch (20–50 units)** — Requires FCC certification (#1) + end-to-end test (#32).
- [ ] **#34 — General launch** — Post-beta, broader sales.

---

## Known Issues & Open Questions

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | **Android offline/camping**: Cast SDK requires internet for session establishment. Android users cannot use Cast in camping mode (no internet). | Medium — Android camping users only | Evaluating: UPnP/DLNA as offline Android fallback |
| 2 | **FCC certification timeline**: ~6–12 weeks and must be done before US sales. | High — hard blocker for launch | Not started — start immediately |
| 3 | **Remote relay + camping conflict**: Cloud relay requires internet. When device is in camping mode, relay is unavailable — this is expected and correct behavior. App must gracefully handle relay-unavailable state and prompt user to join device hotspot. | Low — expected behavior, needs UX handling | UX design needed |
| 4 | **Physical button requirement**: The camping mode toggle and factory reset need a physical button on the device. Must be included in hardware design. | Low — hardware design item | Captured in BOM |
