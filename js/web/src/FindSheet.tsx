// Mobile Find: the phone's list switcher (and item search), opened from
// the left pill in MobileShell.tsx. Shares FindPalette's query policy and
// row anatomy (findResults.tsx) but not its interaction model — there is
// no keyboard cursor, no hover, no key legend. Instead the row matching
// the view you're on carries a "current" mark, the way a native picker
// shows what's already chosen, and the search input is deliberately not
// autofocused: switching lists is the common case on a phone, and popping
// the keyboard on open would cover half the list before a tap lands.
//
// Rendered as a full-screen surface above the floating pills (the
// palette's z band) with an explicit Close, since there is no scrim edge
// to tap outside of.

import { createEffect, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { DocApp } from "./sync/store.ts";
import type { ViewKey } from "./prefs.ts";
import { useAppI18n } from "./i18n.tsx";
import { trackOverlay } from "./overlay.ts";
import checkSvg from "./icons/check.svg?raw";
import {
  createFindState,
  findResultLifecycle,
  FindResultBody,
  type FindResult,
} from "./findResults.tsx";

/** Whether a result row denotes the view currently on screen. Items are
 *  never "current" — they live inside a view rather than being one. */
function isCurrent(item: FindResult, view: ViewKey): boolean {
  if (item.kind === "view") {
    if (item.id === "inbox") return view.kind === "list" && view.id === "inbox";
    return view.kind === item.id;
  }
  if (item.kind === "list") return view.kind === "list" && view.id === item.id;
  return false;
}

export function FindSheet(props: {
  app: DocApp;
  open: boolean;
  view: ViewKey;
  onOpenChange: (open: boolean) => void;
  onSelect?: (result: FindResult) => void;
}) {
  const { m } = useAppI18n();
  trackOverlay(() => props.open);
  const find = createFindState(props.app);
  let listRef: HTMLDivElement | undefined;

  // Fresh query on every open, and bring the current row into view so a
  // long list of lists opens on "where you are" rather than the top.
  createEffect(() => {
    if (!props.open) return;
    find.reset();
    requestAnimationFrame(() => {
      listRef
        ?.querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: "center" });
    });
  });

  // A hardware keyboard's Escape still dismisses, matching every other
  // overlay; capture-phase so the workspace shortcuts behind never see it.
  createEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      props.onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));
  });

  function selectItem(item: FindResult) {
    props.onSelect?.(item);
    props.onOpenChange(false);
  }

  return (
    <Show when={props.open}>
      <Portal>
        <div class="find-sheet" role="dialog" aria-label={m().find.placeholder}>
          <div class="find-sheet__header">
            <input
              class="find-sheet__input"
              type="search"
              placeholder={m().find.placeholder}
              value={find.input()}
              onInput={(e) => find.setInput(e.currentTarget.value)}
              enterkeyhint="search"
              autocapitalize="off"
              autocorrect="off"
            />
            <button
              type="button"
              class="find-sheet__close"
              onClick={() => props.onOpenChange(false)}
            >
              {m().common.close}
            </button>
          </div>
          <div ref={listRef} class="find-sheet__results">
            <For each={find.items()}>
              {(item) => (
                <button
                  type="button"
                  class="palette__item find-sheet__row"
                  classList={{
                    "palette__item--binned": findResultLifecycle(item) === "binned",
                  }}
                  aria-current={isCurrent(item, props.view) ? "true" : undefined}
                  onClick={() => selectItem(item)}
                >
                  <FindResultBody app={props.app} item={item} />
                  <Show when={isCurrent(item, props.view)}>
                    <span
                      class="find-sheet__current"
                      innerHTML={checkSvg}
                      aria-hidden="true"
                    />
                  </Show>
                </button>
              )}
            </For>
            {/* An empty query always yields the default menu (built-ins are
                unconditional), so an empty result set means a query with no
                matches. */}
            <Show when={find.items().length === 0}>
              <div class="palette__empty">{m().find.noMatches}</div>
            </Show>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
