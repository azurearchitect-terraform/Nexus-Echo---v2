import React from "react";
import ReactDOM from "react-dom/client";
import { Overlay } from "./overlay/Overlay";
import { Dashboard } from "./dashboard/Dashboard";
import { useStore } from "./lib/store";
import { pluginHost } from "./lib/plugins";
import meetingIntelligence from "@nexus/plugin-meeting-intelligence";
import "./styles/globals.css";

// Two windows share one bundle; the hash decides which surface renders. This keeps
// a single Vite build and a single warm webview process rather than two.
const route = window.location.hash.replace("#/", "") || "overlay";

void useStore
  .getState()
  .boot()
  .then(() => {
    pluginHost.register(meetingIntelligence);
  })
  .catch((e) => console.error("boot failed", e));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{route === "dashboard" ? <Dashboard /> : <Overlay />}</React.StrictMode>,
);
