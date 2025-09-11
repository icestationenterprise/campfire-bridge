#!/bin/bash
MAC=$1
if [ -z "$MAC" ]; then
echo "Usage: $0 <MAC_ADDRESS>"
exit 1
fi

echo "Pairing with $MAC..."
bluetoothctl pair $MAC
