import { useContext, Switch, Match } from "solid-js";
import { SunlistNav } from "./nav/nav";
import styles from "./app.module.css";
import { PaneRegion } from "./view/view";
import { Footer } from "./nav/footer";
import { Dragged } from "@sunlist/list";
import { sessionContext } from "./store/context.js";
import { Focus } from "./focus/focus";

// TODO: Switch workspace
export function App() {
  const session = useContext(sessionContext);
  return (
    <Switch
      fallback={<p>Scene '{session.viewState.scene[0]()}' does not exist</p>}
    >
      <Match when={session.viewState.scene[0]() == "default"}>
        <div class={styles.app}>
          {session.workspace.dndContext.isDragging() && (
            <Dragged dndContext={session.workspace.dndContext} />
          )}
          {session.workspace.containerModel.dndContext.isDragging() && (
            <Dragged dndContext={session.workspace.containerModel.dndContext} />
          )}
          <div class={styles.main}>
            <SunlistNav />
            <PaneRegion tree={session.viewState.tree} />
          </div>
          <Footer />
        </div>
      </Match>
      <Match when={session.viewState.scene[0]() === "focus"}>
        <Focus item={session.viewState.focus} />
      </Match>
    </Switch>
  );
}
