/* @refresh reload */
import { render } from "solid-js/web";
import {
  Tree,
  DndContext,
  Dragged,
  ListDragContext,
  ListStateContext,
  SolidListContext,
} from "../src/index";
import { loader } from "./nodes";
import { dummyTree } from "./dummy";
import styles from "./dev.module.css";

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

const treeStateA = listStateContext.createTree({ loader });
treeStateA.load(dummyTree({ maxDepth: 1, maxChildren: 5 }));

const treeStateB = listStateContext.createTree({ loader });
treeStateB.load(dummyTree({ maxDepth: 1, maxChildren: 25 }));

const treeStateC = listStateContext.createTree({ loader });
treeStateC.load(dummyTree({ maxDepth: 1, maxChildren: 30000 }));

const ctxA = new ListDragContext({
  treeState: treeStateA,
  dndContext: dndContext,
  itemHeight: 28,
});

const ctxB = new ListDragContext({
  treeState: treeStateB,
  dndContext: dndContext,
  itemHeight: 28,
});

const ctxC = new ListDragContext({
  treeState: treeStateC,
  dndContext: dndContext,
  itemHeight: 28,
});

render(
  () => (
    <div class={styles["app"]}>
      {dndContext.isDragging() && <Dragged dndContext={dndContext} />}
      <div class={styles["container"]}>
        <SolidListContext.Provider value={ctxA}>
          <div
            style={`display: flex; flex-direction: column; height: 100%; width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxA.isFocused() }}
          >
            <h3>Tree A ({treeStateA.count()} items)</h3>
            <Tree />
          </div>
        </SolidListContext.Provider>
        <SolidListContext.Provider value={ctxB}>
          <div
            style={`display: flex; flex-direction: column; height: 100%;  width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxB.isFocused() }}
          >
            <h3>Tree A ({treeStateB.count()} items)</h3>
            <Tree />
          </div>
        </SolidListContext.Provider>
        <SolidListContext.Provider value={ctxC}>
          <div
            style={`display: flex; flex-direction: column; height: 100%;  width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxC.isFocused() }}
          >
            <h3>Tree A ({treeStateC.count()} items)</h3>
            <Tree />
          </div>
        </SolidListContext.Provider>
      </div>
    </div>
  ),
  root!,
);
