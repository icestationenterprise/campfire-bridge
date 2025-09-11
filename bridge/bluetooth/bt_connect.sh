#!/bin/bash
MAC=$(cat /home/bridge/.bt_device)
if [ -n "$MAC" ]; then
bluetoothctl connect $MAC
fi
