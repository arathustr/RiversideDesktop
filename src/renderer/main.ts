import "@fontsource-variable/inter";
import "remixicon/fonts/remixicon.css";

import { createApp } from "vue";
import App from "./App.vue";
import "./styles/tailwind.css";

try {
  const accent = localStorage.getItem("riverside.accent");
  if (accent) document.documentElement.dataset.accent = accent;
} catch {
  // ignore
}

try {
  const scheme = localStorage.getItem("riverside.scheme");
  if (scheme === "dark" || scheme === "light") document.documentElement.dataset.scheme = scheme;
} catch {
  // ignore
}

createApp(App).mount("#app");
