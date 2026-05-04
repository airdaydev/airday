// Find palette: cmd+f opens an overlay with a search input and a
// keyboard-navigable result list. Sprint-1 stub — wired against a
// hard-coded mock list so the shell, kb shortcuts, and styling can be
// validated independently of the real engine query path.

import {
  createEffect,
  createSignal,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";

export type FindItem = {
  id: string;
  name: string;
  kind: "item" | "list";
};

const MOCK_RESULTS: FindItem[] = [
  { id: "i1", name: "Reply to Alex about the proposal", kind: "item" },
  { id: "i2", name: "Buy groceries", kind: "item" },
  { id: "i3", name: "Read Phoenix spec", kind: "item" },
  { id: "i4", name: "Plan team offsite", kind: "item" },
  { id: "i5", name: "Review PR #142", kind: "item" },
  { id: "i6", name: "Draft Q3 roadmap", kind: "item" },
  { id: "l1", name: "Desk", kind: "list" },
  { id: "l2", name: "Work", kind: "list" },
  { id: "l3", name: "Home", kind: "list" },
];

export function FindPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (item: FindItem) => void;
}) {
  const [searchInput, setSearchInput] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Global Cmd/Ctrl+F shortcut. preventDefault to suppress the browser's
  // native page-find UI — we own this binding while the app is mounted.
  const onGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyF") {
      if (e.cancelable) e.preventDefault();
      props.onOpenChange(true);
    }
  };
  document.addEventListener("keydown", onGlobalKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onGlobalKeyDown));

  // Debounced search.
  createEffect(() => {
    const value = searchInput().trim();
    const timer = window.setTimeout(() => setSearchFilter(value), 100);
    onCleanup(() => window.clearTimeout(timer));
  });

  const items = (): FindItem[] => {
    const q = searchFilter().toLowerCase();
    if (!q) return MOCK_RESULTS;
    return MOCK_RESULTS.filter((it) => it.name.toLowerCase().includes(q));
  };

  // Reset selection whenever the result set changes.
  createEffect(() => {
    items();
    setSelectedIndex(0);
  });

  // Reset state and focus input when opening.
  createEffect(() => {
    if (props.open) {
      setSearchInput("");
      setSearchFilter("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  // While open: arrows / Enter / Escape, plus click-outside to dismiss.
  createEffect(() => {
    if (!props.open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        props.onOpenChange(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        e.stopImmediatePropagation();
        const list = items();
        if (!list.length) return;
        if (e.key === "ArrowDown") {
          const next = (selectedIndex() + 1) % list.length;
          setSelectedIndex(next);
          scrollSelectedIntoView(next);
        } else if (e.key === "ArrowUp") {
          const prev = (selectedIndex() - 1 + list.length) % list.length;
          setSelectedIndex(prev);
          scrollSelectedIntoView(prev);
        } else {
          const item = list[selectedIndex()];
          if (item) selectItem(item);
        }
      }
    };
    const onClick = (e: MouseEvent) => {
      const palette = document.getElementById("find-palette");
      if (palette && !palette.contains(e.target as Node)) {
        props.onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    // Defer the click listener a tick so the click that triggered the
    // open (e.g. via menu) doesn't immediately close it.
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onClick);
    }, 0);

    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onClick);
    });
  });

  function scrollSelectedIntoView(index: number) {
    const el = listRef?.querySelector(`[data-index="${index}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }

  function selectItem(item: FindItem) {
    props.onSelect?.(item);
    props.onOpenChange(false);
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="palette-overlay" />
        <div
          id="find-palette"
          class="palette"
          role="combobox"
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-owns="find-palette-listbox"
        >
          <div class="palette__search">
            <input
              ref={(el) => {
                inputRef = el;
              }}
              type="text"
              placeholder="Find"
              value={searchInput()}
              onInput={(e) => setSearchInput(e.currentTarget.value)}
              aria-autocomplete="list"
              aria-controls="find-palette-listbox"
              aria-activedescendant={
                items().length > 0
                  ? `find-palette-item-${selectedIndex()}`
                  : undefined
              }
            />
          </div>
          <div
            ref={listRef}
            id="find-palette-listbox"
            role="listbox"
            class="palette__results"
          >
            <For each={items()}>
              {(item, i) => (
                <div
                  id={`find-palette-item-${i()}`}
                  data-index={i()}
                  role="option"
                  aria-selected={i() === selectedIndex()}
                  class="palette__item"
                  classList={{
                    "palette__item--selected": i() === selectedIndex(),
                  }}
                  onMouseEnter={() => setSelectedIndex(i())}
                  onClick={() => selectItem(item)}
                >
                  <span class="palette__item-name">{item.name}</span>
                  <span class="palette__item-badge-label">
                    {item.kind === "list" ? "List" : "Item"}
                  </span>
                </div>
              )}
            </For>
            <Show when={items().length === 0}>
              <div class="palette__empty">
                {searchFilter() ? "No matches" : "Type to find"}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
