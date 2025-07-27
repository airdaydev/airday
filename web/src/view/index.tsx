import { For, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { Workspace } from "./workspace";
import { PaneDropGuide } from "./pane-drop-guide";
import { DoneView, DataView, UpNextView, CalendarView } from "./views";
import { List } from "../list/list";
import { Done } from "../list/done";
import { Match, Switch } from "solid-js";
import { UpNext } from "../list/up-next";
import { Calendar } from "../cal/cal";

function DataViewComponent(props: ViewProps) {
  return (
    <Switch>
      <Match when={props.view instanceof DoneView}>
        <Done view={props.view} />
      </Match>
      <Match when={props.view instanceof UpNextView}>
        <UpNext view={props.view} />
      </Match>
      <Match when={props.view instanceof CalendarView}>
        <Calendar view={props.view} />
      </Match>
      <Match when={props.view instanceof DataView}>
        <List view={props.view} />
      </Match>
    </Switch>
  );
}

/**
 * Unwraps view object and ensures corresponding view created
 * TODO: This has been simplified down from previous 4 way split but rushed, still
 * some ugly code going on
 */
export function WorkspaceView(props: { workspace: Workspace }) {
  const session = useContext(sessionContext);
  return (
    <div class={styles["pane-region"]}>
      <For
        each={props.workspace.children[0]()}
        fallback={<div>Empty View / loading</div>}
      >
        {(view, index) => (
          <div class={styles["view-cell"]}>
            {session.library.containerStore.dndContext.isDragging() && (
              <PaneDropGuide view={view} />
            )}
            <DataViewComponent view={view} />
          </div>
        )}
      </For>
    </div>
  );
}
