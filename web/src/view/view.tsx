import { createEffect, For, Match, Switch, useContext } from "solid-js";
import styles from "./view.module.css";
import { sessionContext } from "../store/context.js";
import { List } from "../list/list";
import { viewContext, ViewNode, viewState } from "./state";
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
    <For each={props.view.children[0]()} fallback={<div>View Tree</div>}>
      {(view, index) => (
        <Switch>
          <Match when={view.type === "data"}>
            <List view={view} />
          </Match>
          <Match
            when={view.type === "container" && view.direction === "horizontal"}
          >
            <div style={styles.column}>
              <View view={view} />
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
            </div>
          </Match>
          <Match
            when={view.type === "container" && view.direction === "vertical"}
          >
            <View view={view} />
          </Match>
        </Switch>
      )}
    </For>
  );
}

export function PaneRegion() {
  return (
    <viewContext.Provider value={viewState}>
      <div class={styles["pane-region"]}>
        <View view={viewState.tree} />
      </div>
    </viewContext.Provider>
  );
}
