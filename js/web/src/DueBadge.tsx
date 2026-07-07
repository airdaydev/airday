import { createMemo, Show } from "solid-js";
import { formatDueBadge, nowMs, todayStamp } from "./format.tsx";
import timerSvg from "./icons/timer.svg?raw";
import { useAppI18n } from "./i18n.tsx";

// Compact due-date badge shared by list rows and board cards. Reads the
// raw `YYYY-MM-DD` register and renders a short label whose color role
// (`data-tone`) reflects urgency — unless `muted` (done/binned items),
// which drops all urgency styling. Recomputes off the shared `nowMs()`
// tick so "Today"/"Overdue" roll over at local midnight on their own.
export function DueBadge(props: { dueOn: string; muted?: boolean }) {
  const { m, locale } = useAppI18n();
  const info = createMemo(() =>
    formatDueBadge(
      props.dueOn,
      todayStamp(nowMs()),
      {
        overdue: m().due.overdue,
        today: m().due.today,
        tomorrow: m().due.tomorrow,
      },
      locale(),
    ),
  );
  const tone = () => (props.muted ? "muted" : (info()?.urgency ?? "future"));
  return (
    <Show when={info()}>
      {(i) => (
        <span
          class="due-badge"
          data-tone={tone()}
          title={`${m().due.label}: ${props.dueOn}`}
        >
          <span class="due-badge-icon" innerHTML={timerSvg} />
          {i().label}
        </span>
      )}
    </Show>
  );
}
