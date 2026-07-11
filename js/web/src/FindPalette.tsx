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
import type { DocApp } from "./sync/store.ts";
import type { SearchResult } from "./search.ts";
import { useAppI18n } from "./i18n.tsx";
import { isOverlayOpen, trackOverlay } from "./overlay.ts";

export function FindPalette(props: {
  app: DocApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (result: SearchResult) => void;
}) {
  const { m } = useAppI18n();
  trackOverlay(() => props.open);
  const [searchInput, setSearchInput] = createSignal("");
  const [searchFilter, setSearchFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  // Global open shortcuts. preventDefault to suppress the browser's native
  // page-find UI — we own these bindings while the app is mounted.
  //   Cmd/Ctrl+F: require exactly one of meta/ctrl and no shift/alt so OS
  //     shortcuts layered on top (e.g. macOS Cmd+Ctrl+F fullscreen) pass
  //     through. Safe to fire even while typing.
  //   `/`: bare key, so it must not steal a literal slash typed into a row
  //     or input — skip when focus sits in an editable surface.
  const onGlobalKeyDown = (e: KeyboardEvent) => {
    // Don't open on top of another modal (Settings, a confirm dialog).
    // The palette itself counts as open here, but that only blocks a
    // redundant re-open while it's already up.
    if (isOverlayOpen()) return;
    if (e.code === "KeyF") {
      if (e.shiftKey || e.altKey) return;
      if (e.metaKey === e.ctrlKey) return;
    } else if (e.key === "/") {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as Element | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    } else {
      return;
    }
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

  // Display name of the list an item lives in, for the right-hand
  // column. The reserved `main` list isn't a `ListMeta` row — its label
  // is the doc-level override or the localized built-in (mirrors
  // Workspace's homeName). Lists themselves get no label. Returns "" when
  // there's nothing to show.
  function listLabel(item: SearchResult): string {
    if (item.kind !== "item") return "";
    const listId = item.listId;
    if (!listId) return "";
    if (listId === "main") {
      const override = props.app.state.settings.mainName;
      return override && override.length > 0 ? override : m().nav.home;
    }
    return props.app.state.listsById[listId]?.name ?? "";
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
                    "palette__item--binned": item.lifecycle === "binned",
                  }}
                  onMouseEnter={() => setSelectedIndex(i())}
                  onClick={() => selectItem(item)}
                >
                  {/* Slot is always rendered (even for lists) so titles
                      stay aligned across mixed result kinds. */}
                  <span
                    class="palette__item-check"
                    data-kind={item.kind}
                    data-checked={item.lifecycle === "done" ? "" : undefined}
                    aria-hidden="true"
                  />
                  <span class="palette__item-name">{item.title}</span>
                  <Show when={listLabel(item)}>
                    {(label) => (
                      <span class="palette__item-list">{label()}</span>
                    )}
                  </Show>
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
