/**
 * The motion layer: small, self-contained effects the screens compose. Each is
 * modelled on a well-known pattern from React Bits, Aceternity UI, Untitled UI
 * and uiverse, written fresh on Motion (motion.dev) and the app's own design
 * tokens — no raw colours, nothing that ignores prefers-reduced-motion.
 */

export { BlurText } from "./BlurText.jsx";
export { CommandPalette, usePaletteHotkey } from "./CommandPalette.jsx";
export { DotGrid } from "./DotGrid.jsx";
export { FlipText } from "./FlipText.jsx";
export { gsap, reducedMotion, revealOnMount } from "./gsap.js";
export { Magnetic } from "./Magnetic.jsx";
export { Marquee } from "./Marquee.jsx";
export { RoadScene } from "./RoadScene.jsx";
export { Scene } from "./Scene.jsx";
export { SignalChip } from "./SignalChip.jsx";
export { installSpotlight } from "./spotlight.js";
export { Ticker } from "./Ticker.jsx";
export { Tilt } from "./Tilt.jsx";
export { TwinScene } from "./TwinScene.jsx";
