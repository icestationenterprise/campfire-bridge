## Campfire Bridge Mobile App
### React Native mobile application for controlling the Campfire Bridge device.

### 🚀 Getting Started
### Prerequisites
* Node.js 16+
* npm or yarn
* Xcode (for iOS development)
* Android Studio (for Android development)

### Installation
npm install
cd ios && pod install && cd ..

### Running the App
#### iOS
npx react-native run-ios

#### Android
npx react-native run-android


### 🏗️ Project Structure
* src/screens/ - Screen components
* src/components/ - Reusable UI components
* src/services/ - API and service integrations
* src/modules/ - Platform-specific modules
* src/hooks/ - Custom React hooks
* src/context/ - React context providers
* src/utils/ - Utility functions
* __tests__/ - Test files

### 🔧 Development
### Environment Variables

Copy .env.example to .env and fill in your values:
cp .env.example .env

#### Testing
npm test

#### Linting
npm run lint

### 📱 Features
* Device discovery via mDNS
* Spotify integration
* Bluetooth device management
* Real-time playback control
* Samsung Separate App Sound assist

### 📄 License
## MIT License - see LICENSE for details.
