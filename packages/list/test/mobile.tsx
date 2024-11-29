/* @refresh reload */
import { render } from "solid-js/web";
import { Tree, TreeState, DndContext, Dragged } from "../src/index";
import { loader } from "./nodes";
import { dummyChildren } from "./dummy";
import styles from "./dev.module.css";

const root = document.getElementById("root");

const dndContext = new DndContext();

const treeStateA = new TreeState({
  loader,
});
treeStateA.loadChildren(dummyChildren({ maxDepth: 2, maxChildren: 5 }));

render(
  () => (
    <div class={styles["container"]}>
      <div style={`display: flex; flex-direction: column; height: 100%;`}>
        <h3>Tree A ({treeStateA.count()} items)</h3>
        <Tree dndContext={dndContext} state={treeStateA} itemHeight={36} />
      </div>
    </div>
  ),
  root!,
);
