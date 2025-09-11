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
#### Spotify Connect Not Appearing
1. Check librespot service
systemctl status librespot
2. Verify network connectivity
3. Check Spotify credentials in environment variables

