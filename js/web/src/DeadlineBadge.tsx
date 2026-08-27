import { createMemo, Show } from "solid-js";
import { formatDeadlineBadge, nowMs, todayStamp } from "./format.tsx";
import timerSvg from "./icons/timer.svg?raw";
import { useAppI18n } from "./i18n.tsx";

// Compact deadline badge shared by list rows and board cards. Reads the
// raw `YYYY-MM-DD` register and renders a short label whose color role
// (`data-tone`) reflects urgency — unless `muted` (done/binned items),
// which drops all urgency styling and shows a past deadline as the date
// itself rather than "Overdue". Recomputes off the shared `nowMs()` tick
// so "Today"/"Overdue" roll over at local midnight on their own.
export function DeadlineBadge(props: { deadline: string; muted?: boolean }) {
  const { m, locale } = useAppI18n();
  const info = createMemo(() =>
    formatDeadlineBadge(
      props.deadline,
      todayStamp(nowMs()),
      {
        overdue: m().deadline.overdue,
        today: m().deadline.today,
        tomorrow: m().deadline.tomorrow,
      },
      locale(),
      { pastAsDate: props.muted },
    ),
  );
  const tone = () => (props.muted ? "muted" : (info()?.urgency ?? "future"));
  return (
    <Show when={info()}>
      {(i) => (
        <span
          class="badge deadline-badge"
          data-tone={tone()}
          title={`${m().deadline.label}: ${props.deadline}`}
        >
          <span class="deadline-badge-icon" innerHTML={timerSvg} />
          {i().label}
        </span>
      )}
    </Show>
  );
}
