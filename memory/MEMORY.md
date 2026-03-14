# Campfire Bridge — Project Memory

## What This Project Is
A system for playing music on a Bluetooth speaker via a Raspberry Pi bridge.
- **Phone** controls playback via the iOS app (React Native)
- **Bridge (Pi)** runs librespot (Spotify Connect), shairport-sync (AirPlay), PulseAudio + Bluetooth
- **Flow**: Phone ←WiFi/HTTP→ Bridge API → librespot → Bluetooth → Speaker

## App Architecture (as of last session)
- `app/` — React Native 0.72 iOS app (bottom-tab navigator)
- `bridge/api/` — Express/TypeScript API server (runs on Pi)
- `app/mock-bridge.js` — Dev mock of the Pi API, run with `npm run mock`

### Three-Tab Navigation
- **Music** tab → `NowPlayingScreen` → `SpotifyLoginScreen` (stack)
- **Connections** tab → `DevicesScreen`
- **Settings** tab → `SettingsScreen`

### Context hierarchy (App.tsx)
```
SettingsProvider → AppWithContexts → BridgeProvider(url from settings) → SpotifyProvider(clientId from settings) → NavigationContainer
```

### Key files
- `src/context/SettingsContext.tsx` — persists bridgeUrl + spotifyClientId to AsyncStorage
- `src/context/BridgeContext.tsx` — polls bridge API every 2s; exposes play/pause/next/prev/seek/setVolume/BT methods
- `src/context/SpotifyContext.tsx` — PKCE OAuth, token refresh, search, device transfer
- `src/services/spotifyAuth.ts` — pure-JS PKCE + SHA-256; no native deps
- `src/components/Player.tsx` — uses useBridge(); no props needed
- `app/mock-bridge.js` — mock server on :3000; individual REST routes matching BridgeContext

### Deep link for Spotify OAuth
- URL scheme: `campfire://` (registered in `ios/Campfire/Info.plist`)
- Redirect URI: `campfire://spotify-callback`
- Add this redirect URI in Spotify developer dashboard

## Development Terminals
1. `cd app && npm start` — Metro bundler
2. `cd app && npm run mock` — Mock bridge on localhost:3000
3. `cd app && npm run ios` — Build + open simulator (run once; Metro handles reloads)

## Packages Added (need npm install)
- `@react-navigation/bottom-tabs` ^6.5.20
- `@testing-library/react-native` ^12.4.3
- `@testing-library/jest-native` ^5.4.3
- `jest-fetch-mock` ^3.0.3
- `supertest` ^6.3.4
- `ts-jest` ^29.2.0

## Tests
- `__tests__/services/spotifyAuth.test.ts` — PKCE + OAuth helpers
- `__tests__/context/BridgeContext.test.tsx` — polling, commands, BT
- `__tests__/context/SettingsContext.test.tsx` — load/save AsyncStorage
- `__tests__/screens/NowPlayingScreen.test.tsx` — render tests
- `__tests__/screens/DevicesScreen.test.tsx` — render + BT interactions
- `__tests__/screens/SettingsScreen.test.tsx` — render + form interactions
- `__tests__/mock-bridge.test.js` — integration tests against real express app

## Bridge API (Pi side) — NOT YET IMPLEMENTED
Routes the app expects (from BridgeContext):
- GET /api/status → BridgeStatus shape
- POST /api/play, /api/pause, /api/next, /api/previous
- POST /api/seek { position_ms }
- POST /api/volume { volume }
- POST /api/connect, /api/disconnect
- GET /api/bt/devices → { devices: BluetoothDevice[] }
- POST /api/bt/connect { mac }, /api/bt/disconnect { mac }, /api/bt/pair { mac }

## Deleted Files
- src/services/api.ts (replaced by BridgeContext)
- src/services/bridge.ts (replaced by BridgeContext)
- src/hooks/useBridgeConnection.ts (replaced by BridgeContext)
- src/screens/DiscoveryScreen.tsx (replaced by DevicesScreen)
