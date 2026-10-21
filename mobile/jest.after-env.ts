import { configure } from '@testing-library/react-native';
import { AppState } from 'react-native';

// Screen tests resume a session and load the car through several async render
// passes. On a loaded machine (the backend suite, Metro and a second Jest run
// at once) the 1 s default wait and 5 s test limit were exceeded — reproduced,
// and seen as 1–7 failures that passed on rerun. The behaviour under test does
// not depend on speed, so the limits are raised rather than retried.
configure({ asyncUtilTimeout: 5000 });

// On a device AppState.addEventListener returns a subscription to remove; the
// test environment's returns nothing. Give it the device's shape.
jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => {} }) as never);
