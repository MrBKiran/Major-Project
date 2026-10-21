import { createContext, useContext } from 'react';

import type { PushResult } from './push';

/** Whether notifications reach this phone — set once registration has run. */
export const PushStatusContext = createContext<PushResult>('unavailable');

export function usePushStatus(): PushResult {
  return useContext(PushStatusContext);
}
