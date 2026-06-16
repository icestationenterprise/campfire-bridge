# Campfire Bridge Speaker — Session Instructions

This file is loaded automatically by Claude Code at the start of every session.
Read this before doing anything else.

---

## What This Project Is

A commercial hardware product: a wireless speaker with an embedded Linux board (Raspberry Pi) and multiple Bluetooth USB dongles, sold in two SKUs (Limited: 1 dongle; Extended: 4 dongles). A phone streams audio to it via AirPlay (iOS) or Cast (Android). It outputs to a built-in speaker plus up to 1 or 4 paired external Bluetooth speakers simultaneously. Controlled through the Campfire iOS/Android app. Works at home, remotely over the internet, and fully offline (camping mode, no internet, no cell service required).

---

## Where Everything Lives

| What | Path |
|---|---|
| **Living plan + ranked work order** | `PLAN.md` (root of this repo) |
| **Project context + architecture memory** | `memory/MEMORY.md` |
| **React Native app** | `app/` |
| **Bridge firmware + Pi services** | `bridge/` |
| **Bridge API (Express/TS, runs on Pi)** | `bridge/api/` |
| **Global memory pointer** | `~/.claude/projects/-Users-icestation-Projects/memory/campfire-bridge-plan.md` |

**Always load `PLAN.md` at the start of any session that involves building, planning, or deciding what to work on.** It contains the full architecture, all locked decisions, and the ranked work order.

---

## Locked Architectural Decisions

These decisions have already been made and reasoned through. Do not re-open them unless the user explicitly asks.

| Decision | What was decided |
|---|---|
| Audio streaming | **AirPlay 2 (shairport-sync) for iOS, Cast for Android.** librespot (Spotify Connect) has been removed. No Spotify dependency. |
| App role | The Campfire app is a **setup and device management app**, not a playback remote. Playback is through iOS Control Center (AirPlay) and Cast buttons in Android music apps. |
| Pi BT adapter | The Pi's **built-in Bluetooth adapter is disabled**. All speaker outputs go through external USB BT dongles only. |
| Connectivity | Three modes: **Home** (LAN/mDNS), **Remote** (cloud WebSocket relay), **Camping/Offline** (device creates WiFi hotspot, phone joins it, direct LAN, no internet). Camping mode is a **launch requirement**. |
| Backend stack | Node.js/TypeScript + PostgreSQL on Railway or Fly.io. |
| OTA | Mender.io preferred. |
| Serial format | `CB-LTD-XXXXXX` (Limited) / `CB-EXT-XXXXXX` (Extended) |

---

## The Work Order System

`PLAN.md` contains a **Ranked Work Order** (items #1–#34) under the "Action Items" section.

Rules:
- Items are numbered so that prerequisites always have lower numbers than the things that depend on them.
- An item should not be started until all items it depends on are marked complete (`[x]`).
- When an item is completed, update its checkbox in `PLAN.md` from `[ ]` to `[x]`.
- When an item is in progress, mark it `[~]`.

---

## Responding to "What Is Next"

When the user asks **"what is next"** (or any variant like "what should I work on", "next task", etc.):

1. Read the Ranked Work Order in `PLAN.md`.
2. Find the first three items that are `[ ]` (not started) AND whose prerequisites are all `[x]` (complete).
3. Present exactly those three as options — numbered, with a one-sentence description of what doing it involves.
4. Do not suggest an item if any of its dependencies are not yet complete.
5. After the user picks one, help them execute it.

---

## Updating the Plan

When the user completes a task:
- Update the checkbox in `PLAN.md` from `[ ]` to `[x]`.
- If the task has sub-bullets, check those off too.

When the user makes a decision that changes the architecture:
- Update the relevant section of `PLAN.md`.
- Check for downstream items in the work order that may be affected — if a decision invalidates a dependency, flag it before proceeding.
- Update `memory/MEMORY.md` if the change affects the project context.

When the user adds a new requirement:
- Add it to the relevant phase section in `PLAN.md`.
- Insert it into the Ranked Work Order at the correct position based on its dependencies.
- If it conflicts with existing items, say so explicitly before adding it.

---

## Dependency Rules

If the user proposes doing item B before item A, and A is a prerequisite for B, say so clearly and explain why. The user has stated they are willing to change implementation methods, so offer an alternative path if one exists. The goal is always **functionality**, not adherence to the current plan.

Example: "You'd need the backend auth service (#7) running before account screens (#12) can be tested end-to-end. We could stub the auth layer to build the UI first and wire it up later — want to do that instead?"

---

## Git Workflow

- **Never commit or push automatically.** After implementing new, functional code, stop and ask the user to confirm it actually works (they test it — running the app, the script, the device, etc.). Only stage and commit after they explicitly confirm it's working.
- This confirm-before-commit rule applies to *functional code* specifically. Docs/plan updates (e.g. `PLAN.md`, `CLAUDE.md`, `memory/MEMORY.md`) don't need a working-confirmation — commit those once written.
- Once confirmed working, `git add` + `git commit` together with a short, descriptive message (what changed and why, one or two lines). Don't batch unrelated changes into one commit.
- Push to `origin main` once the full task/request is complete (not after every single commit) — i.e. confirm-and-commit per functional change, push per finished task.
- Remote: `https://github.com/icestationenterprise/campfire-bridge.git`

## Known Constraints to Keep in Mind

- **FCC certification** is item #1 and takes 6–12 weeks externally. It is the hard timeline blocker for US sales. Always treat it as running in the background.
- **Android offline/camping**: Cast SDK requires internet for session establishment. Android users cannot use Cast in camping mode. This is a known open issue — do not propose Cast as the camping fallback for Android. UPnP/DLNA is the candidate alternative.
- **AirPlay is iOS only.** Android uses Cast. Do not conflate them.
- **The relay never carries audio.** Audio is always AirPlay or Cast peer-to-peer on the local network. The relay only carries device commands and status updates.
