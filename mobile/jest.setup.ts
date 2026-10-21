// Safe-area insets come from the native side; the library ships a mock for tests.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// The connection state comes from a native module; the library ships a mock.
jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
