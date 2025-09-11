#!/bin/bash

Deploy script for Campfire Bridge
Usage: ./deploy-bridge.sh [PI_HOST]
PI_HOST=${1:-campfire-bridge.local}

echo "Deploying to $PI_HOST..."

Copy files
scp -r ../bridge/ pi@$PI_HOST:/home/pi/campfire-bridge/

Run installation
ssh pi@$PI_HOST "cd /home/pi/campfire-bridge && sudo ./install_bridge.sh"

echo "Deployment complete!"
