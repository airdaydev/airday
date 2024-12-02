/* @refresh reload */
import { render } from "solid-js/web";
import {
  Tree,
  DndContext,
  TreeContext,
  ListStateContext,
  SolidListContext,
  SoloNode,
} from "../src/index";
import { loader } from "./nodes";
import { dummyChildren } from "./dummy";
import styles from "./dev.module.css";

const root = document.getElementById("root");

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between TreeState to allow a shared selection state
const dndContext = new DndContext();

// State context
const listStateContext = new ListStateContext({
  onDelete: (set) => {
    console.log(`Deleting ${set.size} items`);
  },
  onMove: (set) => {
    console.log(`Moving ${set.size} items`);
  },
});

const treeStateA = listStateContext.createTree({ loader });
treeStateA.loadChildren(dummyChildren({ maxDepth: 2, maxChildren: 8 }));

const treeStateB = listStateContext.createTree({ loader });
treeStateB.loadChildren(dummyChildren({ maxDepth: 2, maxChildren: 8 }));

const treeStateC = listStateContext.createTree({ loader });
treeStateC.loadChildren(dummyChildren({ maxDepth: 1, maxChildren: 30000 }));

const ctxA = new TreeContext({
  treeState: treeStateA,
  dndContext: dndContext,
  itemHeight: 32,
  allowInternalMovement: false,
  debug: true,
});

const ctxB = new TreeContext({
  id: "b",
  treeState: treeStateB,
  dndContext: dndContext,
  itemHeight: 32,
  debug: true,
});

const ctxC = new TreeContext({
  id: "c",
  treeState: treeStateC,
  dndContext: dndContext,
  itemHeight: 32,
  debug: true,
});

render(
  () => (
    <div class={styles["app"]}>
      <div class={styles["container"]}>
        <SolidListContext.Provider value={ctxA}>
          <div
            style={`display: flex; flex-direction: column; height: 100%; width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxA.isFocused() }}
          >
            <h3>Tree A ({treeStateA.count()} items) - no drop</h3>
            <span>Focus: {ctxA.isFocused() ? "true" : "false"}</span>
            <Tree />
          </div>
        </SolidListContext.Provider>
        <SolidListContext.Provider value={ctxB}>
          <div
            style={`display: flex; flex-direction: column; height: 100%;  width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxB.isFocused() }}
          >
            <h3>Tree B ({treeStateB.count()} items) - 3 levels</h3>
            <span>Focus: {ctxB.isFocused() ? "true" : "false"}</span>
            <Tree />
          </div>
        </SolidListContext.Provider>
        <SolidListContext.Provider value={ctxC}>
          <div
            style={`display: flex; flex-direction: column; height: 100%;  width: 33.3%;`}
            classList={{ [styles["focus"]]: ctxC.isFocused() }}
          >
            <h3>Tree C ({treeStateC.count()} items)</h3>
            <span>Focus: {ctxC.isFocused() ? "true" : "false"}</span>
            <Tree />
          </div>
        </SolidListContext.Provider>
        <div>
          <h3>A lone item outside of a list</h3>
          <SoloNode
            dndContext={dndContext}
            Component={(props) => (
              <div
                onMouseDown={props.onMouseDown}
                ref={props.ref}
                selected={props.selected}
              >
                Drag
              </div>
            )}
          />
          <h3>A lone item outside of a list, no drop allowed</h3>
          <SoloNode
            dndContext={dndContext}
            enableDrop={false}
            Component={(props) => (
              <div
                onMouseDown={props.onMouseDown}
                ref={props.ref}
                selected={props.selected}
              >
                Drag
              </div>
            )}
          />
        </div>
      </div>
    </div>
  ),
  root!,
);
