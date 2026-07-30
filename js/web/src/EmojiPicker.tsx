import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type JSX,
} from "solid-js";

import { EMOJI_GROUPS, loadEmoji, type Emoji } from "./emoji/data.ts";
import { loadRecentEmoji, pushRecentEmoji } from "./emoji/recents.ts";
import { createEmojiIndex } from "./emoji/search.ts";
import { maxSupportedEmojiVersion } from "./emoji/support.ts";
import { useAppI18n } from "./i18n.tsx";

/** Grid width. Must match `grid-template-columns` on `.emoji-picker__grid`
 *  in styles.css — up/down arrow navigation steps by this. */
const COLUMNS = 8;

/** Pseudo-tab for the recents row, distinguished from the numeric emojibase
 *  group ids that make up the rest of the tab strip. */
const RECENT_TAB = "recent" as const;
type Tab = typeof RECENT_TAB | number;

/** Searchable emoji grid, keyboard-driven from a single search field.
 *
 *  The panel only; the surrounding Popover/Dialog and its trigger belong to
 *  the caller (see `ListIconPicker.tsx`). Data and index are loaded lazily on
 *  first mount and memoised for the page lifetime, so reopening is instant.
 *
 *  Focus stays on the input the whole time and the grid is driven by
 *  `aria-activedescendant`, rather than roving tabindex across ~1900 buttons.
 *  That keeps typing and navigating in one place: type to filter, arrow to
 *  move, Enter to commit. */
export function EmojiPicker(props: {
  /** Currently-chosen grapheme, marked as active in the grid. */
  selected?: string;
  onPick: (emoji: string) => void;
  /** Omit to hide the clear action (for callers where "no icon" isn't a state). */
  onClear?: () => void;
}): JSX.Element {
  const { m } = useAppI18n();
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);

  // Recents come from localStorage synchronously, so the opening tab can be
  // decided up front: land on recents when there are any, since reaching for
  // an icon you've used before is the common case and then needs no
  // navigation at all.
  const initialRecents = loadRecentEmoji();
  const [recents, setRecents] = createSignal(initialRecents);
  const [tab, setTab] = createSignal<Tab>(
    initialRecents.length > 0 ? RECENT_TAB : EMOJI_GROUPS[0].id,
  );

  const [emoji] = createResource(loadEmoji);
  const index = createMemo(() => {
    const all = emoji();
    return all ? createEmojiIndex(all, maxSupportedEmojiVersion()) : null;
  });

  const tabs = createMemo<Tab[]>(() => [
    ...(recents().length > 0 ? [RECENT_TAB] : []),
    ...EMOJI_GROUPS.map((g) => g.id),
  ]);

  /** Flat list currently rendered in the grid — the target of both arrow
   *  navigation and Enter.
   *
   *  Everything here comes out of the dataset, so only real emoji are ever
   *  choosable. The previous picker had a free-form text field alongside the
   *  quick-picks, which happily accepted "$$$" or "??$-" as a list icon; the
   *  search field deliberately does not double as one. */
  const visible = createMemo<Emoji[]>(() => {
    const idx = index();
    if (!idx) return [];
    const q = query().trim();
    if (q.length > 0) return idx.query(q);
    const t = tab();
    if (t === RECENT_TAB) {
      // Drop anything the index no longer knows: a dataset refresh that
      // retires an emoji, an icon this device's fonts can't render, or a
      // junk string left in localStorage by the old free-form field.
      return recents()
        .map((char) => idx.get(char))
        .filter((e): e is Emoji => e !== undefined);
    }
    return idx.byGroup(t);
  });

  // Any change to what's on screen puts the cursor back at the top, so Enter
  // after typing always commits the best match rather than a stale position.
  createEffect(() => {
    visible();
    setActiveIndex(0);
  });

  const activeEmoji = createMemo(() => visible()[activeIndex()]);
  const optionId = (i: number): string => `emoji-opt-${i}`;

  let gridEl: HTMLDivElement | undefined;
  // Keep the cursor in view as it moves; `nearest` avoids yanking the scroll
  // position when the target is already visible.
  createEffect(() => {
    const i = activeIndex();
    gridEl?.querySelector(`#${CSS.escape(optionId(i))}`)?.scrollIntoView({ block: "nearest" });
  });

  const commit = (value: string): void => {
    setRecents(pushRecentEmoji(value));
    props.onPick(value);
  };

  const move = (delta: number): void => {
    const len = visible().length;
    if (len === 0) return;
    setActiveIndex((i) => Math.max(0, Math.min(len - 1, i + delta)));
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(-1);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(COLUMNS);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-COLUMNS);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(Math.max(0, visible().length - 1));
        break;
      case "Enter": {
        const active = activeEmoji();
        if (!active) return;
        e.preventDefault();
        commit(active.emoji);
        break;
      }
      // Escape falls through to the enclosing Popover, which closes.
    }
  };

  const groupLabel = (t: Tab): string =>
    t === RECENT_TAB
      ? m().emoji.recent
      : (m().emoji.groups[
          EMOJI_GROUPS.find((g) => g.id === t)?.labelKey ?? "smileys"
        ] ?? "");

  const tabIcon = (t: Tab): string =>
    t === RECENT_TAB ? "🕘" : (EMOJI_GROUPS.find((g) => g.id === t)?.icon ?? "");

  return (
    <div class="emoji-picker">
      <input
        class="emoji-picker__search"
        type="text"
        role="combobox"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        aria-expanded
        aria-controls="emoji-picker-grid"
        aria-autocomplete="list"
        aria-activedescendant={activeEmoji() ? optionId(activeIndex()) : undefined}
        aria-label={m().emoji.search}
        placeholder={m().emoji.search}
        value={query()}
        onInput={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        // Autofocus is right here: the panel only exists because the user
        // just opened it, and typing is the fastest path to any emoji.
        ref={(el) => queueMicrotask(() => el.focus())}
      />

      {/* Tabs are hidden while searching — results span every group, so a
          group selector would only mislead. */}
      <Show when={query().trim().length === 0}>
        <div class="emoji-picker__tabs" role="tablist" aria-label={m().emoji.category}>
          <For each={tabs()}>
            {(t) => (
              <button
                type="button"
                class="emoji-picker__tab"
                role="tab"
                aria-selected={tab() === t}
                aria-label={groupLabel(t)}
                title={groupLabel(t)}
                data-active={tab() === t ? "" : undefined}
                onClick={() => setTab(t)}
              >
                {tabIcon(t)}
              </button>
            )}
          </For>
        </div>
      </Show>

      <div
        class="emoji-picker__grid"
        id="emoji-picker-grid"
        role="listbox"
        aria-label={m().emoji.search}
        ref={gridEl}
      >
        <Show
          when={index()}
          fallback={
            <p class="emoji-picker__status">
              {emoji.error ? m().emoji.loadFailed : m().emoji.loading}
            </p>
          }
        >
          <Show
            when={visible().length > 0}
            fallback={<p class="emoji-picker__status">{m().emoji.noResults}</p>}
          >
            <For each={visible()}>
              {(e, i) => (
                <button
                  type="button"
                  class="emoji-picker__option"
                  id={optionId(i())}
                  role="option"
                  aria-selected={activeIndex() === i()}
                  aria-label={e.annotation}
                  title={e.annotation}
                  tabIndex={-1}
                  data-cursor={activeIndex() === i() ? "" : undefined}
                  data-chosen={props.selected === e.emoji ? "" : undefined}
                  // `mousedown` over `click` so the press doesn't first blur
                  // the search input and tear down the panel's focus state.
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    commit(e.emoji);
                  }}
                  onMouseEnter={() => setActiveIndex(i())}
                >
                  {e.emoji}
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>

      <div class="emoji-picker__footer">
        <Show
          when={activeEmoji()}
          fallback={<span class="emoji-picker__preview-name" />}
        >
          {(active) => (
            <>
              <span class="emoji-picker__preview">{active().emoji}</span>
              <span class="emoji-picker__preview-name">{active().annotation}</span>
            </>
          )}
        </Show>
        <Show when={props.onClear}>
          {(onClear) => (
            <button
              type="button"
              class="emoji-picker__clear"
              disabled={props.selected === undefined}
              onClick={() => onClear()()}
            >
              {m().workspace.removeIcon}
            </button>
          )}
        </Show>
      </div>
    </div>
  );
}
