/**
 * The screens the app sends to the car: one small document each, drawn by the native module
 * (modules/autosaarthi-car, CarModel.kt). Every word on the car's screen is chosen here, in
 * TypeScript, from the same owner wording the phone and the web use; the native side draws it and
 * reports taps. This file is the contract between the two — keep it in step with CarModel.kt.
 *
 *   pane     a glanceable card: a few rows and at most two buttons. Its rows cannot be tapped.
 *   list     rows to choose from; a row with an `action` is tappable.
 *   message  one sentence, with an optional spinner and up to two buttons.
 */

export interface CarAction {
  id: string;
  title: string;
  /** The main button of the screen. */
  primary?: boolean;
  /** The car's own host also refuses this tap while the car is moving. */
  parkedOnly?: boolean;
}

export interface CarRow {
  title: string;
  /** Up to two lines under the title. */
  text?: string[];
  /** Makes a list row tappable; reported back as `{ screen, action }`. */
  action?: string;
  parkedOnly?: boolean;
}

export interface CarScreenModel {
  /** Names the screen; updating or popping to it refers to this. */
  id: string;
  kind: 'pane' | 'list' | 'message';
  title: string;
  message?: string;
  rows?: CarRow[];
  actions?: CarAction[];
  loading?: boolean;
  /** What a list says when it has no rows. */
  empty?: string;
  /** A back arrow in the header instead of the app icon. */
  back?: boolean;
}

/** What the car can do, as the controller sees it (src/car/native.ts is the real one). */
export interface CarNative {
  isConnected(): boolean;
  /** The first screen, replacing everything open. False if no car is connected. */
  root(screen: CarScreenModel): boolean;
  /** A screen on top of the one open. */
  push(screen: CarScreenModel): boolean;
  /** New content for a screen that is open; nothing is drawn again if it is unchanged. */
  update(screen: CarScreenModel): boolean;
  /** Back one screen, or back to the screen with this id. */
  pop(toId?: string | null): boolean;
  on(event: 'onConnected' | 'onDisconnected', handler: () => void): () => void;
  on(event: 'onAction', handler: (e: { screen: string; action: string }) => void): () => void;
  on(event: 'onStack', handler: (e: { ids: string[] }) => void): () => void;
}
