import { For, useContext, Switch, Match } from "solid-js";
import { BordeNav } from "./nav/nav";
import styles from "./app.module.css";
import { viewState } from "./view/state";
import { View } from "./view/view";
import { Footer } from "./nav/footer";
import { Dragged } from "@borde/list";
import { sessionContext } from "./store/context.js";
import { Focus } from "./focus/focus";

// TODO: Switch workspace
export function App() {
  const session = useContext(sessionContext);
  return (
    <Switch fallback={<p>Fallback</p>}>
      <Match when={viewState.scene[0]() == "normal"}>
        <div class={styles.app}>
          {session.workspace.dndContext.isDragging() && (
            <Dragged dndContext={session.workspace.dndContext} />
          )}
          {session.workspace.containerModel.dndContext.isDragging() && (
            <Dragged dndContext={session.workspace.containerModel.dndContext} />
          )}
          <div class={styles.main}>
            <BordeNav />
            <For each={viewState.list[0]()} fallback={<div>fallback</div>}>
              {(view, index) => <View view={view[0]()} tabId={index()} />}
            </For>
          </div>
          <Footer />
        </div>
      </Match>
      <Match when={viewState.scene[0]() === "focus"}>
        <Focus item={viewState.focus} />
      </Match>
    </Switch>
  );
}
