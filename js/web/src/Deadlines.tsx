import { createMemo, For, Show } from "solid-js";
import { DueBadge } from "./DueBadge.tsx";
import { formatDueBadge, nowMs, todayStamp } from "./format.tsx";
import { useAppI18n } from "./i18n.tsx";
import { isOpen, type DocApp, type ItemView } from "./sync/store.ts";

interface DeadlineGroup {
  /** Group key: `"overdue"` for everything before today, else the raw
   *  `YYYY-MM-DD` stamp shared by the group's items. */
  key: string;
  label: string;
  urgency: "overdue" | "today" | "future";
  items: ItemView[];
}

/** Right-hand deadline rail (desktop only): every Open item carrying a
 *  due date, soonest first, grouped by calendar day. Overdue items fold
 *  into a single leading group since they're all equally "owed now".
 *  Done / binned items never appear — nothing is still due on them.
 *  Clicking a row reveals the item in its home list. */
export function Deadlines(props: {
  app: DocApp;
  onReveal: (id: string) => void;
}) {
  const { m, locale } = useAppI18n();

  const groups = createMemo<DeadlineGroup[]>(() => {
    const today = todayStamp(nowMs());
    const dated = Object.values(props.app.state.itemsById)
      .filter((it) => isOpen(it) && it.dueOn)
      .sort(
        (a, b) =>
          a.dueOn!.localeCompare(b.dueOn!) ||
          a.createdAt - b.createdAt,
      );
    const labels = {
      overdue: m().due.overdue,
      today: m().due.today,
      tomorrow: m().due.tomorrow,
    };
    const out: DeadlineGroup[] = [];
    for (const it of dated) {
      const info = formatDueBadge(it.dueOn!, today, labels, locale());
      if (!info) continue;
      const key = info.urgency === "overdue" ? "overdue" : it.dueOn!;
      const last = out[out.length - 1];
      if (last && last.key === key) {
        last.items.push(it);
      } else {
        out.push({ key, label: info.label, urgency: info.urgency, items: [it] });
      }
    }
    return out;
  });

  const listName = (listId: string): string => {
    if (listId === "inbox") return m().nav.inbox;
    return props.app.state.listsById[listId]?.name ?? listId;
  };

  return (
    <aside class="deadlines" aria-label={m().deadlines.title}>
      <div class="deadlines-header">{m().deadlines.title}</div>
      <div class="deadlines-scroll">
        <Show
          when={groups().length > 0}
          fallback={<div class="deadlines-empty">{m().deadlines.empty}</div>}
        >
          <For each={groups()}>
            {(g) => (
              <section class="deadlines-group" data-urgency={g.urgency}>
                <h2 class="deadlines-group-label">{g.label}</h2>
                <For each={g.items}>
                  {(it) => (
                    <button
                      type="button"
                      class="deadlines-row"
                      onClick={() => props.onReveal(it.id)}
                    >
                      <span class="deadlines-row-text">{it.text}</span>
                      <span class="deadlines-row-meta">
                        <span class="deadlines-row-list">
                          {listName(it.listId)}
                        </span>
                        {/* The group header already names the day, so
                            only overdue rows (header: "Overdue") carry a
                            badge, showing the date that slipped. */}
                        <Show when={g.urgency === "overdue"}>
                          <DueBadge dueOn={it.dueOn!} muted />
                        </Show>
                      </span>
                    </button>
                  )}
                </For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
