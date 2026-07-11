import { Popover } from "@kobalte/core/popover";
import { createSignal, For, Show } from "solid-js";

import fileSvg from "./icons/file.svg?raw";
import { useAppI18n } from "./i18n.tsx";

/** Curated quick-pick emoji shown at the top of the list-icon picker.
 *  These are just defaults — the free-form input below accepts any
 *  emoji. Stored verbatim as the literal grapheme (see
 *  `Doc::set_list_icon`). */
const QUICK_PICKS = [
  "📥",
  "📌",
  "🎯",
  "💡",
  "✅",
  "🔥",
  "📚",
  "🗓️",
  "💼",
  "🏠",
  "🛒",
  "✈️",
  "🎨",
  "💪",
  "🎵",
  "⭐",
  "🌱",
  "🧠",
  "💰",
  "🐛",
] as const;

/** Header affordance for a user-created list: renders the list's icon
 *  (the chosen emoji, or the default file glyph when unset) and opens a
 *  popover to pick a curated emoji, type an arbitrary one, or clear it.
 *  Reserved `main` (Home) has no `ListMeta` row and never renders this. */
export function ListIconPicker(props: {
  icon: string | undefined;
  onPick: (icon: string) => void;
  onClear: () => void;
}): ReturnType<typeof Popover> {
  const { m } = useAppI18n();
  const [open, setOpen] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  const commit = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    props.onPick(trimmed);
    setDraft("");
    setOpen(false);
  };

  return (
    <Popover open={open()} onOpenChange={setOpen} placement="bottom-start" gutter={6}>
      <Popover.Trigger
        class="list-icon-trigger"
        aria-label={m().workspace.listIcon}
      >
        <Show when={props.icon} fallback={<span innerHTML={fileSvg} />}>
          {(icon) => <span class="list-icon-emoji">{icon()}</span>}
        </Show>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content class="list-icon-popover">
          <div class="list-icon-grid">
            <For each={QUICK_PICKS}>
              {(emoji) => (
                <button
                  type="button"
                  class="list-icon-option"
                  data-active={props.icon === emoji ? "" : undefined}
                  onClick={() => commit(emoji)}
                >
                  {emoji}
                </button>
              )}
            </For>
          </div>
          <div class="list-icon-actions">
            <input
              class="list-icon-input"
              type="text"
              value={draft()}
              placeholder={m().workspace.iconInputPlaceholder}
              aria-label={m().workspace.iconInputPlaceholder}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit(draft());
                }
              }}
            />
            <button
              type="button"
              class="list-icon-remove"
              disabled={props.icon === undefined}
              onClick={() => {
                props.onClear();
                setOpen(false);
              }}
            >
              {m().workspace.removeIcon}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}
