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
import { matchesName, type SearchResult } from "./search.ts";
import { useAppI18n } from "./i18n.tsx";
import { isOverlayOpen, trackOverlay } from "./overlay.ts";
import archiveSvg from "./icons/archive.svg?raw";
import arrowsDownUpSvg from "./icons/arrows-down-up.svg?raw";
import checkSvg from "./icons/check.svg?raw";
import drawingPinSvg from "./icons/drawing-pin.svg?raw";
import fileSvg from "./icons/file.svg?raw";

// The built-in views (Focus / Inbox / Done) aren't `ListMeta` rows, so the
// search engine never indexes them (spec/search.md "Palette-level
// entries"). The palette synthesizes them: always present in the default
// (empty-query) menu, and name-matched into query results so "foc" finds
// Focus the way it finds a user list.
export type ViewResultId = "focus" | "inbox" | "done";
export interface ViewResult {
  kind: "view";
  id: ViewResultId;
  title: string;
}
export type FindResult = SearchResult | ViewResult;

// Fixed nav icons, mirrored so a built-in reads the same here as in the
// sidebar.
const VIEW_ICONS: Record<ViewResultId, string> = {
  focus: drawingPinSvg,
  inbox: archiveSvg,
  done: checkSvg,
};

export function FindPalette(props: {
  app: DocApp;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect?: (result: FindResult) => void;
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

  // Localized labels re-derive when the language changes; nav order.
  const builtinViews = (): ViewResult[] => [
    { kind: "view", id: "focus", title: m().nav.focus },
    { kind: "view", id: "inbox", title: m().nav.inbox },
    { kind: "view", id: "done", title: m().nav.done },
  ];

  // Re-run on every doc version bump too, so a peer or local mutation
  // while the palette is open updates the visible result set.
  const items = createMemo((): FindResult[] => {
    const q = searchFilter();
    props.app.version();
    if (!q) {
      // Default menu: the built-in views then every active list, in nav
      // order — the palette doubles as a jump-to-view switcher before the
      // user types anything. Archived lists stay reachable by query only.
      const lists: SearchResult[] = [];
      for (const id of props.app.state.listsOrder) {
        const l = props.app.state.listsById[id];
        if (!l || l.archivedAt != null) continue;
        lists.push({ id: l.id, kind: "list", title: l.name, score: 0 });
      }
      return [...builtinViews(), ...lists];
    }
    // Built-ins match by name like a list result would (shared tokenizer
    // semantics via matchesName) and sit above everything — they're the
    // pinned nav entries.
    const views = builtinViews().filter((v) => matchesName(v.title, q));
    const results = props.app.search.query(q, 50);
    // Float list results above items, preserving each group's relevance
    // order (Array.sort is stable). The palette owns this presentation
    // tweak — the engine's ranking is left untouched.
    const sorted = results
      .slice()
      .sort((a, b) => (a.kind === "list" ? 0 : 1) - (b.kind === "list" ? 0 : 1));
    return [...views, ...sorted];
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

  function selectItem(item: FindResult) {
    props.onSelect?.(item);
    props.onOpenChange(false);
  }

  // Display name of the list an item lives in, for the right-hand
  // column. The reserved `inbox` list isn't a `ListMeta` row — it always
  // renders the localized built-in label. Lists themselves get no label.
  // Returns "" when there's nothing to show.
  function listLabel(item: FindResult): string {
    if (item.kind !== "item") return "";
    const listId = item.listId;
    if (!listId) return "";
    if (listId === "inbox") return m().nav.inbox;
    return props.app.state.listsById[listId]?.name ?? "";
  }

  // Chosen icon for a list result (a literal emoji grapheme), or
  // undefined when unset — the caller falls back to the default file
  // glyph, mirroring the nav.
  function listIcon(item: FindResult): string | undefined {
    if (item.kind !== "list") return undefined;
    return props.app.state.listsById[item.id]?.icon;
  }

  // Fixed nav icon for a built-in view entry, undefined for other kinds.
  function viewIcon(item: FindResult): string | undefined {
    if (item.kind !== "view") return undefined;
    return VIEW_ICONS[item.id];
  }

  // Lifecycle of an item result ("" for other kinds) — union-safe access
  // for the binned strike-through and the done checkbox mirror.
  function itemLifecycle(item: FindResult): string {
    return item.kind === "item" ? item.lifecycle ?? "" : "";
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
                    "palette__item--binned": itemLifecycle(item) === "binned",
                  }}
                  onMouseEnter={() => setSelectedIndex(i())}
                  onClick={() => selectItem(item)}
                >
                  {/* Slot is always rendered so titles stay aligned across
                      mixed result kinds: a checkbox mirror for items, the
                      list's icon for lists, the fixed nav icon for
                      built-in views. */}
                  <Show
                    when={item.kind !== "item"}
                    fallback={
                      <span
                        class="task-check palette__item-check"
                        data-kind={item.kind}
                        data-checked={
                          itemLifecycle(item) === "done" ? "" : undefined
                        }
                        aria-hidden="true"
                      />
                    }
                  >
                    <Show
                      when={viewIcon(item)}
                      fallback={
                        <Show
                          when={listIcon(item)}
                          fallback={
                            <span
                              class="palette__item-icon"
                              innerHTML={fileSvg}
                              aria-hidden="true"
                            />
                          }
                        >
                          {(icon) => (
                            <span
                              class="palette__item-icon palette__item-icon-emoji"
                              aria-hidden="true"
                            >
                              {icon()}
                            </span>
                          )}
                        </Show>
                      }
                    >
                      {(svg) => (
                        <span
                          class="palette__item-icon"
                          innerHTML={svg()}
                          aria-hidden="true"
                        />
                      )}
                    </Show>
                  </Show>
                  <span class="palette__item-name">{item.title}</span>
                  <Show when={listLabel(item)}>
                    {(label) => (
                      <span class="palette__item-list">{label()}</span>
                    )}
                  </Show>
                </div>
              )}
            </For>
            {/* An empty query always yields the default menu (built-ins are
                unconditional), so an empty result set means a query with no
                matches. */}
            <Show when={items().length === 0}>
              <div class="palette__empty">{m().find.noMatches}</div>
            </Show>
          </div>
          <div class="palette__footer" aria-hidden="true">
            <span class="palette__hint">
              <kbd class="menu-shortcut" innerHTML={arrowsDownUpSvg} />
              {m().find.hintSelect}
            </span>
            <span class="palette__hint">
              <kbd class="menu-shortcut">↵</kbd>
              {m().find.hintOpen}
            </span>
            <span class="palette__hint">
              <kbd class="menu-shortcut">esc</kbd>
              {m().find.hintClose}
            </span>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
