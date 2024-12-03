/* @refresh reload */
import { render } from "solid-js/web";
import {
  Tree,
  DndContext,
  TreeContext,
  ListStateContext,
  SolidListContext,
  SoloNode,
  TreeState,
} from "../src/index";
import { loader } from "./nodes";
import { dummyChildren } from "./dummy";
import styles from "./dev.module.css";
import { Dragged } from "../src/dragged";
import * as dat from "dat.gui";

const root = document.getElementById("root");

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between TreeState to allow a shared selection state
const dndContext = new DndContext({
  mode: "custom",
});

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
treeStateA.loadChildren(dummyChildren({ maxDepth: 3, maxChildren: 8 }));

const treeStateB = listStateContext.createTree({ loader });
treeStateB.loadChildren(dummyChildren({ maxDepth: 1, maxChildren: 30000 }));

const ctxA = new TreeContext({
  id: "a",
  treeState: treeStateA,
  dndContext: dndContext,
  itemHeight: 32,
  debug: true,
});

const ctxB = new TreeContext({
  id: "b",
  treeState: treeStateB,
  dndContext: dndContext,
  itemHeight: 32,
  debug: true,
});

render(
  () => (
    <div class={styles["app"]}>
      {dndContext.isCustomDragging() && <Dragged dndContext={dndContext} />}
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
        <div>
          <h3>A lone item outside of a list</h3>
          <SoloNode
            dndContext={dndContext}
            Component={(props) => (
              <div onMouseDown={props.onMouseDown}>Drag</div>
            )}
          />
          <h3>A lone item outside of a list, no drop allowed</h3>
          <SoloNode
            dndContext={dndContext}
            enableDrop={false}
            Component={(props) => (
              <div onMouseDown={props.onMouseDown}>Drag</div>
            )}
          />
        </div>
      </div>
    </div>
  ),
  root!,
);

class guiModifier {
  id: string;
  treeState: TreeState;
  maxChildren = 100;
  maxDepth = 2;
  constructor(id: string, treeState: TreeState) {
    this.id = id;
    this.treeState = treeState;
  }
  loadChildren = () => {
    this.treeState.loadChildren(
      dummyChildren({ maxDepth: this.maxDepth, maxChildren: this.maxChildren }),
    );
  };
  gui = (gui: dat.GUI) => {
    const folder = gui.addFolder(this.id);
    folder.open();
    folder.add(this, "maxChildren", 1, 50).step(1);
    folder.add(this, "maxDepth", 1, 3).step(1);
    folder.add(this, "loadChildren").name("Generate tree");
  };
}

const context = {
  mode: dndContext.mode[0](),
};

const gui = new dat.GUI();
const contextFolder = gui.addFolder("Context");
contextFolder.open();
contextFolder
  .add(context, "mode", {
    ["Custom Drag"]: "custom",
    ["HTML Native Drag"]: "native",
  })
  .name("Drag Mode")
  .onChange((value) => {
    switch (value) {
      case "native":
        dndContext.mode[1]("native");
        break;
      case "custom":
        dndContext.mode[1]("custom");
        break;
      default:
    }
  });

const guiA = new guiModifier("Tree A", treeStateA);
const guiB = new guiModifier("Tree B", treeStateB);

guiA.gui(gui);
guiB.gui(gui);
