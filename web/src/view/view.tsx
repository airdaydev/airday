import { For, Match, Switch, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { List } from "../list/list";
import { ViewNode } from "./state";
import { PaneDropGuide } from "./pane-drop-guide";

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
          Empty View {props.view.id} {props.view.type}
        </div>
      }
    >
      {(view, index) => (
        <Switch>
          <Match when={view.type === "data"}>
            <div class={styles["view-cell"]}>
              {session.workspace.containerModel.dndContext.isDragging() && (
                <PaneDropGuide
                  view={view}
                  yikes={/*TODO: Clean Up Below */ true}
                  container={session.workspace.containerModel.dndContext.listContexts
                    .values()
                    .next()
                    .value.getFirstSelected()}
                />
              )}
              <List view={view} />
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
