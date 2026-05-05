// cmd/ctrl+f opens an overlay with a search input and a keyboard-
// navigable result list. Backed by the local SearchEngine attached to
// the workspace's DocApp — the palette is a thin view over it. See
// spec/search.md for index semantics and ranking.

import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import type { DocApp } from "./store.ts";
import type { SearchResult } from "./search.ts";
import { useAppI18n } from "./i18n.tsx";

export function FindPalette(props: {
  app: DocApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (result: SearchResult) => void;
}) {
  const { m } = useAppI18n();
  const [searchInput, setSearchInput] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Global Cmd/Ctrl+F shortcut. preventDefault to suppress the browser's
  // native page-find UI — we own this binding while the app is mounted.
  // Require exactly one of meta/ctrl and no shift/alt so OS shortcuts
  // layered on top (e.g. macOS Cmd+Ctrl+F fullscreen) pass through.
  const onGlobalKeyDown = (e: KeyboardEvent) => {
    if (e.code !== "KeyF") return;
    if (e.shiftKey || e.altKey) return;
    if (e.metaKey === e.ctrlKey) return;
    if (e.cancelable) e.preventDefault();
    props.onOpenChange(true);
  };
  document.addEventListener("keydown", onGlobalKeyDown);
  onCleanup(() => document.removeEventListener("keydown", onGlobalKeyDown));

  // Debounced search. Sub-frame human latency tolerance — keeps us off
  // the tokenize/postings hot path on every keystroke without an
  // observable input lag.
  createEffect(() => {
    const value = searchInput().trim();
    const timer = window.setTimeout(() => setSearchFilter(value), 100);
    onCleanup(() => window.clearTimeout(timer));
  });

  // Re-run on every doc version bump too, so a peer or local mutation
  // while the palette is open updates the visible result set.
  const items = createMemo((): SearchResult[] => {
    const q = searchFilter();
    if (!q) return [];
    props.app.version();
    return props.app.search.query(q, 50);
  });

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

  function selectItem(item: SearchResult) {
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
              placeholder={m().find.placeholder}
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
                  <span class="palette__item-name">{item.title}</span>
                  <span class="palette__item-badge-label">
                    {item.kind === "list" ? m().find.listBadge : m().find.itemBadge}
                  </span>
                </div>
              )}
            </For>
            <Show when={items().length === 0}>
              <div class="palette__empty">
                {searchFilter() ? m().find.noMatches : m().find.typeToFind}
              </div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
