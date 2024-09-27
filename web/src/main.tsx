/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./app";
import "./main.css";
import { sessionContext, sunlistSession } from "./store/context";

// Setup app state
sunlistSession.loadWorkspaceCache();

// Attach debug helpers to window
window.session = sunlistSession;

// TODO: Render while store is alive (i.e. Allow models to run without db layer)
const root = document.getElementById("root");

if (!(root instanceof HTMLElement)) {
  throw new Error("App root missing.");
}

render(
  () => (
    <sessionContext.Provider value={sunlistSession}>
      <App />
    </sessionContext.Provider>
  ),
  root,
);
