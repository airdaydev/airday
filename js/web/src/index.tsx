import { render } from "solid-js/web";
import { BrowserTabGate } from "./BrowserTabGate.tsx";
import { AppI18nProvider } from "./i18n.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
render(
  () => (
    <AppI18nProvider>
      <BrowserTabGate />
    </AppI18nProvider>
  ),
  root,
);
