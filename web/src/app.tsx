import { useContext, Switch, Match } from "solid-js";
import { AirNav } from "./nav/nav";
import styles from "./app.module.css";
import { View } from "./view/view";
import { Footer } from "./nav/footer";
import { Dragged } from "@airday/list";
import { sessionContext } from "./store/context.js";
import { Focus } from "./focus/focus";

// TODO: Switch library
export function App() {
  const session = useContext(sessionContext);
  return (
    <Switch
      fallback={<p>Scene '{session.viewState.scene[0]()}' does not exist</p>}
    >
      <Match when={session.viewState.scene[0]() == "default"}>
        <div class={styles.app}>
          {session.library.dndContext.isCustomDragging() && (
            <Dragged dndContext={session.library.dndContext} />
          )}
          {session.library.containerStore.dndContext.isCustomDragging() && (
            <Dragged dndContext={session.library.containerStore.dndContext} />
          )}
          <div class={styles.main}>
            <AirNav />
            <View views={session.viewState.views} />
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
