// Single-tab gate. Airday assumes one active tab per browser (the
// engine + IDB op log aren't built for concurrent writers), so we grab
// a Web Lock on mount and only render `App` once we hold it. A second
// tab fails to acquire the lock and shows a "already open elsewhere"
// notice instead. The lock releases on cleanup, so closing the holding
// tab lets a waiting one take over on its next mount.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { useAppI18n } from "./i18n.tsx";
import { App } from "./App.tsx";

const SINGLE_TAB_LOCK_NAME = "airday-single-tab";

export function BrowserTabGate() {
  const { m } = useAppI18n();
  const [gate, setGate] = createSignal<"checking" | "allowed" | "blocked">(
    "checking",
  );

  onMount(() => {
    if (!shouldEnforceSingleTab()) {
      setGate("allowed");
      return;
    }
    if (!("locks" in navigator) || !navigator.locks) {
      console.warn("navigator.locks unavailable; single-tab gate disabled");
      setGate("allowed");
      return;
    }

    let release: (() => void) | null = null;
    void navigator.locks.request(
      SINGLE_TAB_LOCK_NAME,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          setGate("blocked");
          return;
        }
        setGate("allowed");
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    );

    onCleanup(() => {
      release?.();
    });
  });

  return (
    <Show when={gate() !== "checking"} fallback={<div class="empty">{m().common.loading}</div>}>
      <Show
        when={gate() === "allowed"}
        fallback={
          <div class="empty">
            Airday is already open in another tab.
          </div>
        }
      >
        <App />
      </Show>
    </Show>
  );
}

function shouldEnforceSingleTab(): boolean {
  const flag = (import.meta.env as Record<string, string | boolean | undefined>)[
    "VITE_ENFORCE_SINGLE_TAB"
  ];
  if (flag === "0") return false;
  if (flag === "1") return true;

  const url = new URL(window.location.href);
  if (url.searchParams.get("multiTab") === "1") return false;

  return !import.meta.env.DEV;
}
