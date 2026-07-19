// Keyboard-shortcut cheat sheet, opened with `?`. A plain reference list —
// the shortcuts themselves live in Workspace.tsx / Row.tsx; this just
// documents them. Registered with trackOverlay so it suppresses the global
// shortcuts while open, like the other dialogs.

import { Dialog } from "@kobalte/core/dialog";
import { For } from "solid-js";
import { useAppI18n } from "./i18n.tsx";
import { trackOverlay } from "./overlay.ts";

export function ShortcutsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { m } = useAppI18n();
  trackOverlay(() => props.open);

  const rows = (): { label: string; key: string | string[] }[] => {
    const s = m().shortcuts;
    return [
      { label: s.newItem, key: "Space" },
      { label: s.openItem, key: "Enter" },
      { label: s.editItem, key: "⌘ Enter" },
      { label: s.toggleDone, key: "X" },
      { label: s.toggleFocus, key: "F" },
      { label: s.duplicate, key: "⌘D" },
      { label: s.copy, key: "⌘C" },
      { label: s.undo, key: "⌘Z" },
      { label: s.redo, key: "⌘⇧Z" },
      { label: s.bin, key: "⌫" },
      { label: s.switchList, key: "[ ]" },
      { label: s.switchLane, key: "← →" },
      { label: s.find, key: ["⌘F", "/"] },
      { label: s.showShortcuts, key: "?" },
    ];
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <div class="dialog-positioner">
          <Dialog.Content class="shortcuts-dialog">
            <Dialog.Title class="shortcuts-dialog-title">
              {m().shortcuts.title}
            </Dialog.Title>
            <div class="shortcuts-dialog-list">
              <For each={rows()}>
                {(r) => (
                  <div class="shortcuts-dialog-row">
                    <span>{r.label}</span>
                    <span class="shortcuts-dialog-keys">
                      <For each={Array.isArray(r.key) ? r.key : [r.key]}>
                        {(k) => <kbd class="menu-shortcut">{k}</kbd>}
                      </For>
                    </span>
                  </div>
                )}
              </For>
            </div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}
