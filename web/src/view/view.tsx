import { For, Match, Switch, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { List } from "../list/list";
import { ViewNode } from "./state";
import { PaneDropGuide } from "./pane-drop-guide";
import { Done } from "../list/done";

interface ViewProps {
  view: ViewNode;
}

/**
 * Unwraps view object and ensures corresponding view created
 */
export function View(props: ViewProps) {
  const session = useContext(sessionContext);
  return (
    <For
      each={props.view.children[0]()}
      fallback={
        <div>
          Empty View {props.view.id} {props.view.type} / loading
        </div>
      }
    >
      {(view, index) => (
        <Switch>
          <Match when={view.type === "data"}>
            <div class={styles["view-cell"]}>
              {session.workspace.containerStore.dndContext.isDragging() && (
                <PaneDropGuide
                  view={view}
                  container={session.workspace.containerStore
                    .getNavDnd()
                    .getFirstSelected()}
                />
              )}
              <List view={view} />
            </div>
          </Match>
          <Match when={view.type === "done"}>
            <div class={styles["view-cell"]}>
              {/* make a subtype for data instead */}
              <Done />
            </div>
          </Match>
          <Match
            when={view.type === "container" && view.direction === "horizontal"}
          >
            <div class={styles["horizontal-container"]}>
              <View view={view} />
            </div>
          </Match>
          <Match
            when={view.type === "container" && view.direction === "vertical"}
          >
            <div class={styles["vertical-container"]}>
              <View view={view} />
            </div>
          </Match>
        </Switch>
      )}
    </For>
  );
}

export function PaneRegion(props: { tree: ViewNode }) {
  return (
    <div class={styles["pane-region"]}>
      <View view={props.tree} />
    </div>
  );
}
