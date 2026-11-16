# Build the STANDARD unit, step by step

One action per step. After each stage there is a **You should see** check; if
you don't see it, stop there and paste the exact screen text into the chat.
Build on the bench first; the box is the last part.

Branch: `lightest-certifiable-campfire`. These stages were written while the
first unit was assembled (2026-11-08 to 11-16) and updated to the setup script
that now does the AirPlay build and the hardware overlays itself.

**Two things before you start**
- If you have a second Campfire device on the network (the Pi 5 rig), unplug it.
  Both are called `campfire-bridge.local` and your Mac will reach the wrong one.
- "On your Mac" means the prompt looks like `you@Mac ~ %`. "On the Pi" means
  the prompt looks like `pi@campfire-bridge:~ $`, which you get through `ssh`.
  Same Terminal window, different machine. Passwords don't echo while you type.

**Parts to lay out:** Pi 4 · Waveshare UPS HAT (B) with its charger, screws
and standoffs · 2 × Samsung 35E cells · MAX98357A amp with its loose header
pins · Peerless 2" driver · Dayton passive radiator (no wires; waits for the
box) · Ezurio BT851 · microSD card · two momentary buttons with wires · RGB LED
(4 legs) · three 330 Ω resistors · jumper wires (female sockets both ends, plus a
few male-female) · speaker wire · gasket tape · heatsink · M2.5 kit.
**Tools:** soldering iron and solder, wire strippers, small Phillips, scissors,
tape or heat-shrink, calipers, a microSD reader for the Mac.

---

## Part A — the computer

**Stage 1. Write the memory card.**
1. Card into the Mac. If macOS says the disk is unreadable, click **Ignore**.
2. Download Raspberry Pi Imager from raspberrypi.com/software and open it.
3. **Device** → Raspberry Pi 4. **OS** → Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)**. **Storage** → the card.
4. **Next** → edit the settings: hostname `campfire-bridge`; username `pi` and a password you write down; your WiFi name and password (if your router has a "-5G" twin, use that one); country `US`; your time zone. Services: **Enable SSH**, password authentication.
5. **Save** → **Yes** → **Yes**. Wait for "Write Successful", then remove the card.

**Stage 2. First boot and connect.**
1. Heatsink onto the Pi's big square chip. Card into the slot under the Pi, contacts toward the board. USB-C power in. Wait 90 seconds.
2. Open Terminal on the Mac.

**On your Mac:**
```bash
ssh-keygen -R campfire-bridge.local
ssh pi@campfire-bridge.local
```
Type `yes`, then the password.

You should see: a prompt ending `pi@campfire-bridge:~ $`.
If "could not resolve hostname": wait a minute and retry; after five minutes, redo Stage 1 and check the WiFi name.

**Stage 3. Install everything.** One block, then a long wait (20–30 minutes; it compiles the AirPlay software). If it asks for a password, type the Pi's. If a blue/pink full-screen box asks about restarting services, press Enter.

**On the Pi:**
```bash
sudo apt update && sudo apt install -y git
git clone -b lightest-certifiable-campfire https://github.com/icestationenterprise/campfire-bridge.git /home/pi/campfire-bridge
bash /home/pi/campfire-bridge/bridge/setup-pi.sh
```
When the prompt comes back after "Setup complete":

**On the Pi:**
```bash
sudo reboot
```
Wait 90 seconds, reconnect with `ssh pi@campfire-bridge.local`.

**Stage 4. Check AirPlay.** In the Campfire app, start a party (it can be empty). On the iPhone: Control Center → long-press the music tile → AirPlay.

You should see: **Campfire** in the list.
If not:

**On the Pi:**
```bash
systemctl --user status shairport-sync | head -5
systemctl status nqptp | head -3
```
Paste both outputs into the chat.

---

## Part B — the electronics

**Finding a pin.** Hold the Pi with the 40 pins along the top edge and the
microSD slot on the left. Two rows: **outer** (along the edge) and **inner**.
Count positions 1–20 from the left. Outer row = even pins (position 1 is pin 2,
position 20 is pin 40). Inner row = odd pins (position 1 is pin 1, position 20
is pin 39).

**Soldering, first time.** Iron on, two minutes, wipe the tip. Touch the tip to
both the pad and the wire for two seconds, feed a little solder into the joint,
pull the solder away, then the iron. A good joint is a small shiny cone.
Everything below with the Pi powered off.

**Stage 5. Amp and speaker.**
1. Push the short ends of a 7-pin header strip up through the amp board's holes from the bottom; tape it straight; solder the 7 pins on top.
2. Cut 20 cm of speaker wire, split and strip 5 mm at both ends. Tin the driver's two tabs; solder one wire to each.
3. Other ends into the amp's green terminal: `+` and `−`, screws tight.
4. Jumpers, amp pin → Pi pin: `Vin` → 2 (outer, 1) · `GND` → 6 (outer, 3) · `BCLK` → 12 (outer, 6) · `LRC` → 35 (inner, 18) · `DIN` → 40 (outer, 20). `GAIN` and `SD`: nothing.
5. Power up, reconnect.

**On the Pi:**
```bash
aplay -l | grep MAX98357A
curl -s localhost:3000/api/status | grep -o '"builtin_sink":"[^"]*"'
speaker-test -D pulse -c 2 -t sine -f 440 -l 1
```
You should see: a `MAX98357A` line, then `"builtin_sink":"alsa_output.platform-soc_sound.stereo-fallback"`, and hear a tone.
If the second line is empty: the bridge could not find the amp's sink. Run `pactl list short sinks` and paste it.

**Stage 6. Mute button.** Cut a jumper in half, strip the ends, solder one half to each of the button's two wires, tape the joints. Sockets onto pins **37** and **39** (inner row, positions 19 and 20); either way round.

**On the Pi:**
```bash
pinctrl set 26 ip pu; pinctrl get 26
```
You should see `hi`; hold the button and run the second command again: `lo`.

**Stage 7. Power button.** Same method, sockets onto pins **5** and **9** (inner row, positions 3 and 5). Don't test it yet; a press shuts the Pi down once the setup script's overlay is active (Stage 10).

**Stage 8. LED.** Longest leg = **common**. The single leg on one side of it is **red**; the two on the other side are **green**, then **blue**.
1. Solder a 330 Ω resistor to each colour leg, never to the common.
2. Half a jumper onto the far end of each resistor and one directly onto the common leg. Tape every joint.
3. Plug in: common → pin **1** (inner, 1; 3.3 V) · red → pin **36** (outer, 18) · green → pin **33** (inner, 17) · blue → pin **32** (outer, 16).

**On the Pi:**
```bash
pinctrl set 12 op dl; sleep 1; pinctrl set 12 op dh
```
You should see: blue for one second. (`16` is red, `13` is green.)
If nothing: your LED is the other type. Move the common leg from pin 1 to pin 34 (outer, 17), and colours light on `dh` instead of `dl`. Then set `LED_ACTIVE_HIGH=1` in `bridge/systemd/campfire-panel.service` and re-run the setup script.

Once the panel daemon is running (it starts with the setup script), the LED is driven by it: pulsing blue while booting, white on home WiFi, orange on the hotspot, red if the bridge is down. Pressing the mute button makes it flash.

**Stage 9. Radio and the first party.**
1. BT851 into one of the two **black** USB ports.

**On the Pi:**
```bash
bluetoothctl show | grep Powered
```
You should see `Powered: yes`. If `no`, wait a minute and check again (the stick takes a moment the first time); if still `no`: `sudo rfkill unblock bluetooth && bluetoothctl power on`.
2. Put the JBL in pairing mode (hold its Bluetooth button until it blinks). In the app: Connections → pair it → connect → start a party.
3. AirPlay to Campfire from the phone.

You should hear: the JBL and the bench speaker together; "2 speakers in sync" in the app. Balance them with Earlier/Later.
4. Mute button: short press silences the bench speaker only; hold one second silences both; repeat to unmute. The LED flashes on each press.

---

## Part C — battery and box

**Stage 10. Battery HAT.**
1. HAT switch **OFF**. Cells in, `+` (flat end) as marked, spring end first. The **WARNING** light must stay dark.
2. Shut down and unplug:

**On the Pi:**
```bash
sudo poweroff
```
3. Pull every jumper off the header (note where each was). Mount the HAT under the Pi on its own standoffs so the spring pins press squarely on the header's solder tails.
4. Jumpers back exactly as before. HAT switch **ON**. The Pi boots from the cells; leave the USB-C supply unplugged while the HAT is on.
5. Wait 90 s, reconnect.

**On the Pi:**
```bash
vcgencmd get_throttled; i2cdetect -y 1
```
You should see `throttled=0x0` and one address in the grid (Waveshare's code expects `43`).
6. Power button: one press. The green light stops within 15 s. Press again: it boots. Then check `i2cdetect -y 1` still shows the gauge; if not, say so (the shutdown pin and the gauge share a wire, and there is a fallback).
7. Charge with the HAT's 8.4 V charger in its jack; it charges while playing.

**Stage 11. The box**, when the print arrives: `hardware/phase1/enclosure/README.md`
has the assembly order. Before printing, measure hole-to-hole across the driver
and across the radiator and set them in the model.

Then run the bench tests in `docs/bench-tests.md`.
