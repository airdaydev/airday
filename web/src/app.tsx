import { For, useContext } from "solid-js";
import { BordeNav } from "./nav/nav";
import styles from "./app.module.css";
import { viewState } from "./view-state";
import { View } from "./view";
import { Footer } from "./nav/footer";
import { Dragged } from "@borde/list";
import { sessionContext } from "./store/context.js";

// TODO: Switch workspace
export function App() {
  const session = useContext(sessionContext);
  return (
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
  );
}
