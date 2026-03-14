/** @type {import('jest').Config} */
module.exports = {
  preset: 'react-native',

  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react' } }],
  },

  // Resolve the @/ path alias used throughout the app
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },

  setupFiles: ['./jest.setup.js'],
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],

  // Don't try to transform node_modules except RN libraries that ship raw JSX
  transformIgnorePatterns: [
    'node_modules/(?!(react-native' +
    '|@react-native' +
    '|@react-navigation' +
    '|react-native-vector-icons' +
    '|react-native-screens' +
    '|react-native-safe-area-context' +
    '|react-native-gesture-handler' +
    '|@react-native-async-storage' +
    '|@react-native-community' +
    ')/)',
  ],
};
