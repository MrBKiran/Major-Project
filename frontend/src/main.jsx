import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The deck's faces, bundled rather than fetched from Google Fonts: a slow or
// blocked font host silently swapped the whole app to system fonts (seen in
// the screenshot baseline), and the demo has to work offline.
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
