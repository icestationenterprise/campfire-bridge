#!/usr/bin/env python3
"""
Campfire Bridge — front panel daemon: RGB status LED + mute button.

LED (wired common-anode on the bench unit, so it is driven active-low; set
LED_ACTIVE_HIGH=1 for a common-cathode part):
  pulsing blue   booting, or on the hotspot with no home WiFi saved (unconfigured)
  white          on home WiFi
  orange         camping hotspot
  red            the bridge API has not answered for ERROR_AFTER_S seconds

Mute button (GPIO26 to GND, internal pull-up, reads low when pressed):
  short press    toggle mute of the built-in speaker only
  hold >= 1 s    toggle mute of every speaker in the party

The power button on GPIO3 is handled by the gpio-shutdown overlay and
systemd-logind, not by this daemon. GPIO3 is also what wakes a halted Pi.
"""
import json
import os
import subprocess
import time
import urllib.request

from gpiozero import Button, RGBLED

API           = os.environ.get("CAMPFIRE_API", "http://127.0.0.1:3000")
ACTIVE_HIGH   = os.environ.get("LED_ACTIVE_HIGH", "0") == "1"
PIN_R, PIN_G, PIN_B = 16, 13, 12
PIN_BUTTON    = 26
POLL_S        = 2.0
ERROR_AFTER_S = 30.0
BOOT_GRACE_S  = 120.0
HOTSPOT_CON   = "campfire-hotspot"
BUILTIN_ID    = "builtin"

WHITE  = (1.0, 1.0, 1.0)
ORANGE = (1.0, 0.25, 0.0)
RED    = (1.0, 0.0, 0.0)
BLUE   = (0.0, 0.0, 1.0)
OFF    = (0.0, 0.0, 0.0)


def log(msg):
    print(f"[panel] {msg}", flush=True)


def api(method, path, body=None, timeout=3.0):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "{}")


class Panel:
    def __init__(self):
        try:
            self.led = RGBLED(red=PIN_R, green=PIN_G, blue=PIN_B, active_high=ACTIVE_HIGH, pwm=True)
            self.pwm = True
        except Exception as e:  # no PWM-capable pin factory → plain on/off
            log(f"PWM unavailable ({e}); LED will blink instead of pulse")
            self.led = RGBLED(red=PIN_R, green=PIN_G, blue=PIN_B, active_high=ACTIVE_HIGH, pwm=False)
            self.pwm = False
        self.button = Button(PIN_BUTTON, pull_up=True, bounce_time=0.05, hold_time=1.0)
        self.button.when_held = self.on_held
        self.button.when_released = self.on_released
        self.held = False
        self.state = None
        self.started = time.monotonic()
        self.last_ok = None
        self._saved_cache = (0.0, True)

    # ── LED ────────────────────────────────────────────────────────────────
    def show(self, state):
        if state == self.state:
            return
        self.state = state
        log(f"LED -> {state}")
        if state in ("booting", "unconfigured"):
            if self.pwm:
                self.led.pulse(fade_in_time=1.0, fade_out_time=1.0, on_color=BLUE, off_color=OFF, background=True)
            else:
                self.led.blink(on_time=0.5, off_time=0.5, on_color=BLUE, off_color=OFF, background=True)
        elif state == "home":
            self.led.color = WHITE
        elif state == "camping":
            self.led.color = ORANGE
        elif state == "error":
            self.led.color = RED
        else:
            self.led.color = OFF

    def flash(self, color, times=1):
        """Short acknowledgement of a button press, then back to the state colour."""
        prev = self.state
        for _ in range(times):
            self.led.color = OFF
            time.sleep(0.08)
            self.led.color = color
            time.sleep(0.15)
        self.state = None
        self.show(prev)

    # ── Button ─────────────────────────────────────────────────────────────
    def on_held(self):
        self.held = True
        try:
            speakers = api("GET", "/api/status").get("party", {}).get("speakers", [])
            if not speakers:
                log("hold: no party running")
                self.flash(RED)
                return
            mute = any(not s.get("muted") for s in speakers)
            api("POST", "/api/party/mute", {"muted": mute})
            log(f"hold: {'muted' if mute else 'unmuted'} all {len(speakers)} speaker(s)")
            self.flash(RED if mute else WHITE)
        except Exception as e:
            log(f"hold: API error: {e}")
            self.flash(RED, 2)

    def on_released(self):
        if self.held:
            self.held = False
            return
        try:
            speakers = api("GET", "/api/status").get("party", {}).get("speakers", [])
            builtin = next((s for s in speakers if s.get("mac") == BUILTIN_ID), None)
            if builtin is None:
                log("press: built-in speaker is not in the party")
                self.flash(RED)
                return
            mute = not builtin.get("muted", False)
            api("POST", "/api/party/speaker/mute", {"mac": BUILTIN_ID, "muted": mute})
            log(f"press: built-in {'muted' if mute else 'unmuted'}")
            self.flash(RED if mute else WHITE)
        except Exception as e:
            log(f"press: API error: {e}")
            self.flash(RED, 2)

    # ── State ──────────────────────────────────────────────────────────────
    def home_wifi_saved(self):
        """True if NetworkManager has a saved WiFi profile other than the hotspot. Cached 30 s."""
        at, val = self._saved_cache
        now = time.monotonic()
        if now - at < 30.0:
            return val
        try:
            out = subprocess.run(["nmcli", "-t", "-f", "NAME,TYPE", "con", "show"],
                                 capture_output=True, text=True, timeout=5).stdout
            val = any(
                typ in ("802-11-wireless", "wifi") and name != HOTSPOT_CON
                for name, _, typ in (line.partition(":") for line in out.splitlines())
            )
        except Exception:
            val = True  # cannot tell; do not claim "unconfigured" on a guess
        self._saved_cache = (now, val)
        return val

    def tick(self):
        now = time.monotonic()
        try:
            status = api("GET", "/api/status", timeout=2.0)
        except Exception:
            if self.last_ok is None and now - self.started < BOOT_GRACE_S:
                self.show("booting")
            elif self.last_ok is None or now - self.last_ok > ERROR_AFTER_S:
                self.show("error")
            return
        self.last_ok = now
        if status.get("network_mode") == "camping":
            self.show("camping" if self.home_wifi_saved() else "unconfigured")
        else:
            self.show("home")

    def run(self):
        log(f"starting (LED {'active-high' if ACTIVE_HIGH else 'active-low'}, API {API})")
        self.show("booting")
        while True:
            try:
                self.tick()
            except Exception as e:
                log(f"tick error: {e}")
            time.sleep(POLL_S)


if __name__ == "__main__":
    Panel().run()
