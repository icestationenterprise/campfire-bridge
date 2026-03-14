// // metro.config.js (React Native 0.72.x)
// const { getDefaultConfig } = require('metro-config');

// module.exports = (async () => {
//   const config = await getDefaultConfig(__dirname);
//   // Add common extra extensions so Metro can find TS/modern modules
//   config.resolver.sourceExts = [
//     ...config.resolver.sourceExts,
//     'cjs',
//     'mjs',
//     'ts',
//     'tsx',
//   ];
//   return config;
// })();

// metro.config.js (RN 0.72+)
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const defaultConfig = getDefaultConfig(__dirname);

module.exports = mergeConfig(defaultConfig, {
  resolver: {
    // Make sure Metro knows where the AssetRegistry is
    assetRegistryPath: 'react-native/Libraries/Image/AssetRegistry',
  },
  transformer: {
    // keep defaults; do not override with custom transformers yet
  },
});
