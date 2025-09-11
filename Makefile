.PHONY: build:ios build:android lint test clean

App commands
build:ios:
cd app && npx react-native run-ios

build:android:
cd app && npx react-native run-android

Linting
lint:
cd app && npx eslint . --ext .ts,.tsx
cd bridge/api && npx eslint . --ext .ts

Testing
test:
cd app && npm test
cd bridge/api && npm test

Clean
clean:
cd app && rm -rf node_modules && rm -rf ios/build && rm -rf android/app/build
cd bridge/api && rm -rf node_modules && rm -rf dist

Deploy bridge
deploy-bridge:
scp -r bridge/ pi@campfire-bridge.local :/home/pi/campfire-bridge/
ssh pi@campfire-bridge.local "cd /home/pi/campfire-bridge && sudo ./install_bridge.sh"
