/* @refresh reload */
import { render } from "solid-js/web";
import { App } from "./app";
import "./main.css";
import { sessionContext, airSession } from "./store/context";

// Setup app state
airSession.loadLibraryCache();

// Attach debug helpers to window
window.session = airSession;

// TODO: Render while store is alive (i.e. Allow models to run without db layer)
const root = document.getElementById("root");

if (!(root instanceof HTMLElement)) {
  throw new Error("App root missing.");
}

render(
  () => (
    <sessionContext.Provider value={airSession}>
      <App />
    </sessionContext.Provider>
  ),
  root,
);
