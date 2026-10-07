/**
 * "Continue with Google" — Google Identity Services.
 *
 * Google renders the button and hands back an ID token (`credential`); the backend
 * verifies it and decides whether that Google account belongs to anyone. Nothing here
 * decides anything about who may sign in.
 *
 * Google only accepts the page's origin if it is registered on the OAuth client, and it
 * refuses raw IP addresses and non-HTTPS origins other than `localhost` — so this works
 * on http://localhost:5173 but not from a phone at http://192.168.x.x:5173.
 */

import { useEffect, useRef } from "react";

const GIS_SRC = "https://accounts.google.com/gsi/client";

let gisLoading = null; // one <script> for the whole page, however many buttons mount

function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve(window.google);
      s.onerror = () => {
        gisLoading = null; // allow a later retry
        reject(new Error("could not load Google sign-in"));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

export default function GoogleButton({ clientId, onCredential, onError }) {
  const slot = useRef(null);
  // The latest callbacks, without re-initialising Google's button every render.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;
    loadGis()
      .then((google) => {
        if (cancelled || !slot.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handlers.current.onCredential(response.credential),
        });
        google.accounts.id.renderButton(slot.current, {
          theme: "filled_black",
          size: "large",
          shape: "rectangular",
          text: "continue_with",
          width: 320,
        });
      })
      .catch((e) => handlers.current.onError?.(e.message));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return <div ref={slot} className="flex min-h-[44px] justify-center" />;
}
