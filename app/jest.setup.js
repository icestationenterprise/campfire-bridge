// Enable jest-fetch-mock so all fetch() calls are interceptable
const fetchMock = require('jest-fetch-mock');
fetchMock.enableMocks();

// Global AsyncStorage mock — individual tests can override with jest.mock(...)
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:    jest.fn(() => Promise.resolve(null)),
  setItem:    jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet:   jest.fn(() => Promise.resolve([])),
  multiSet:   jest.fn(() => Promise.resolve()),
  multiRemove: jest.fn(() => Promise.resolve()),
  clear:      jest.fn(() => Promise.resolve()),
}));
