import { lazy, Suspense, useState } from "react";
import { webglAvailable } from "./Scene.jsx";

// Its own chunk, like the sign-in road: only an owner's My Car page loads three.js.
const CarTwin = lazy(() => import("./CarTwin.jsx"));

/** The owner's 3D car where the browser can draw it; a quiet placeholder where
 *  it cannot (no WebGL, tests) and while the chunk downloads. */
export function TwinScene({ className = "", ...props }) {
  const [supported, setSupported] = useState(webglAvailable);
  const placeholder = (
    <div
      aria-hidden="true"
      className={`grid place-items-center text-label text-fg-subtle ${className}`}
    >
      3D view
    </div>
  );
  if (!supported) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <CarTwin className={className} onUnsupported={() => setSupported(false)} {...props} />
    </Suspense>
  );
}
