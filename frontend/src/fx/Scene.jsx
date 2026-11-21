import { lazy, Suspense, useState } from "react";
import { RoadScene } from "./RoadScene.jsx";

// three.js is the heaviest dependency in the app and only the sign-in hero uses
// it, so it is its own chunk: the console never downloads it.
const Road3D = lazy(() => import("./Road3D.jsx"));

function webglAvailable() {
  if (typeof window === "undefined" || /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** The hero's world: real 3D where the browser can draw it, the SVG road where
 *  it cannot (no WebGL, tests) — and while the 3D chunk is still downloading. */
export function Scene({ className = "", fallbackClassName = "" }) {
  const [supported, setSupported] = useState(webglAvailable);
  const fallback = <RoadScene className={fallbackClassName} />;
  if (!supported) return fallback;
  return (
    <Suspense fallback={fallback}>
      <Road3D className={className} onUnsupported={() => setSupported(false)} />
    </Suspense>
  );
}
