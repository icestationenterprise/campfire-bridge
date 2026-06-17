## Troubleshooting Guide
### Common Issues
#### Bluetooth Connection Problems
1. Ensure the speaker is in pairing mode
2. Check if the device is already paired:
bluetoothctl devices
3. Remove and re-pair if necessary
bluetoothctl remove <MAC_ADDRESS>
bluetoothctl pair <MAC_ADDRESS>
#### Audio Not Playing
1. Check PulseAudio status:
systemctl status pulseaudio
2. Verify the Bluetooth sink is available:
pactl list sinks
3. Test audio output:
paplay /usr/share/sounds/alsa/Front_Left.wav
#### API Not Responding
1. Check if the service is running:
systemctl status bridge-api
2. Check logs:
journalctl -u bridge-api -f
#### AirPlay Device Not Appearing
1. Check that party mode is active — AirPlay (shairport-sync) only runs while party mode is on
systemctl --user status shairport-sync
2. Verify the phone is on the same network as the bridge (or joined its hotspot in camping mode)
3. Confirm campfire_party sink exists
pactl list short sinks | grep campfire_party

