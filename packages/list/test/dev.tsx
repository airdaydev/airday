/* @refresh reload */
import { render } from "solid-js/web";
import { Tree, TreeState, DndContext, Dragged } from "../src/index";
import { loader } from "./nodes";
import { dummyTree } from "./dummy";
import styles from "./dev.module.css";
import { ListStateContext } from "../src/state";

const root = document.getElementById("root");

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between TreeState to allow a shared selection state
const dndContext = new DndContext();

const listStateContext = new ListStateContext({
  onDelete: (set) => {
    console.log(`Deleting ${set.size} items`);
  },
  onMove: (set) => {
    console.log(`Moving ${set.size} items`);
  },
});

const treeStateA = listStateContext.createTree({
  loader,
});
treeStateA.load(dummyTree({ maxDepth: 1, maxChildren: 5 }));

const treeStateB = listStateContext.createTree({ loader, dndContext });
treeStateB.load(dummyTree({ maxDepth: 1, maxChildren: 25 }));

const treeStateC = listStateContext.createTree({ loader, dndContext });
treeStateC.load(dummyTree({ maxDepth: 1, maxChildren: 30000 }));

render(
  () => (
    <div class={styles["container"]}>
      {dndContext.isDragging() && <Dragged dndContext={dndContext} />}
      <div style={`display: flex; flex-direction: column; height: 100%;`}>
        <h3>Tree A ({treeStateA.count()} items)</h3>
        <Tree
          dndContext={dndContext}
          state={treeStateA}
          itemHeight={28}
          // draggable
          // multiselect
          // height={(node) => {}} // Node height calculation function or number
        />
      </div>
      <div style={`display: flex; flex-direction: column; height: 100%;`}>
        <h3>Tree B ({treeStateB.count()} items)</h3>
        <Tree dndContext={dndContext} state={treeStateB} itemHeight={28} />
      </div>
      <div style={`display: flex; flex-direction: column; height: 100%;`}>
        <h3>Tree C ({treeStateC.count()} items)</h3>
        <Tree dndContext={dndContext} state={treeStateC} itemHeight={28} />
      </div>
    </div>
  ),
  root!,
);
