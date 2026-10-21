# Phase 1 wiring — Raspberry Pi 4 Model B (STANDARD and EXTENDED)

Physical pin numbers are the 40-pin header, pin 1 nearest the microSD slot
corner. Diagram: `wiring-pi4b.svg`. Enclosure: `enclosure-layout.svg`.

## Built-in speaker — MAX98357A (I²S)

| Pi pin | Signal | MAX98357A pin |
|---|---|---|
| 2 | 5 V | VIN |
| 6 | GND | GND |
| 12 | GPIO18 / PCM_CLK | BCLK |
| 35 | GPIO19 / PCM_FS | LRC |
| 40 | GPIO21 / PCM_DOUT | DIN |
| — | (unconnected) | SD → mono (L+R)/2 mix |
| — | (unconnected) | GAIN → 9 dB |
| — | speaker `+` / `−` | 2-inch 4 Ω driver |

`/boot/firmware/config.txt`:
```
dtparam=i2s=on
dtoverlay=max98357a
```
Sink name appears in `pactl list short sinks`; set it as `BUILTIN_SINK_NAME`.

## Button

| Pi pin | Signal | Part |
|---|---|---|
| 37 | GPIO26 (internal pull-up) | momentary button, one leg |
| 39 | GND | other leg |

Short press = camping toggle · long press (3 s) = power/sleep · 10 s = factory
reset. Handled in software (S5 milestone); no overlay needed.

## RGB LED (common cathode)

| Pi pin | Signal | LED |
|---|---|---|
| 36 | GPIO16 | R via 330 Ω |
| 33 | GPIO13 / PWM1 | G via 330 Ω |
| 32 | GPIO12 / PWM0 | B via 330 Ω (hardware PWM → smooth "pulsing blue") |
| 34 | GND | cathode |

States: pulsing blue = unconfigured · white = home · orange = camping · red = error.

## Power — UPS board (2 × 18650)

| Pi pin | Signal | UPS board |
|---|---|---|
| 2 / 4 | 5 V in | board's 5 V output (pogo pins or header) |
| 6 | GND | GND |
| 3 | GPIO2 / SDA1 | INA219 SDA |
| 5 | GPIO3 / SCL1 | INA219 SCL |

`dtparam=i2c_arm=on`. The safe-shutdown service reads the gauge over I²C and
runs `systemctl poweroff` below the threshold. USB-C charge input on the rear
panel. If the board feeds power only through its own USB-A, use a 15 cm
USB-A→USB-C cable into the Pi's power port instead of pins 2/4.

## Radios — USB

| Port | STANDARD | EXTENDED | Placement |
|---|---|---|---|
| USB 2.0 (black) #1 | BT851 **A** | BT851 **A** | front-centre of the bay |
| USB 2.0 (black) #2 | — | BT851 **B**, 20 cm extension | rear-right corner |
| USB 3.0 (blue) #1 | — | BT851 **C**, 20 cm extension | rear-left corner |
| USB 3.0 (blue) #2 | free | free | |

USB 3.0 ports radiate at 2.4 GHz; the extension moves radio C away from the
connector. The API prefers radios on USB 2.0 ports (S7 milestone).

## Pins deliberately free

GPIO20 (pin 38) is claimed as PCM_DIN by the I²S overlay — do not use it.
GPIO4/5, 8/9, 0/1 stay free for Phase 2 UART radios.
