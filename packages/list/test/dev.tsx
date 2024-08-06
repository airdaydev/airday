/* @refresh reload */
import { render } from 'solid-js/web';
import {
  Tree, TreeState, DndContext, Dragged,
} from '../src/index';
import { loader } from './nodes';
import { dummyTree } from './dummy';
import styles from './dev.module.css';

const root = document.getElementById('root');

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between TreeState to allow a shared selection state
const dndContext = new DndContext();

const treeStateA = new TreeState({
  loader,
});
treeStateA.load(dummyTree({ maxDepth: 2, maxChildren: 5 }));

const treeStateB = new TreeState({ loader, dndContext });
treeStateB.load(dummyTree({ maxDepth: 1, maxChildren: 25 }));

const treeStateC = new TreeState({ loader, dndContext });
treeStateC.load(dummyTree());

render(() => (
  <div class={styles['container']}>
    {dndContext.isDragging[0]() && (
      <Dragged dndContext={dndContext} />
    )}
    <div style={`display: flex; flex-direction: column; height: 100%;`}>
      <h3>Tree A ({treeStateA.count()} items)</h3>
      <input type="text" placeholder="filter text" />
      <Tree
        dndContext={dndContext}
        state={treeStateA}
        // draggable
        // multiselect
        // height={(node) => {}} // Node height calculation function or number
      />
    </div>
    {/* <div style={`display: flex; flex-direction: column; height: 100%;`}>
      <h3>Tree B ({treeStateB.count()} items)</h3>
      <input type="text" placeholder="filter text" />
      <Tree
        dndContext={dndContext}
        state={treeStateB}
      />
    </div>
    <div style={`display: flex; flex-direction: column; height: 100%;`}>
      <h3>Tree C ({treeStateC.count()} items)</h3>
      <input type="text" placeholder="filter text" />
      <Tree
        dndContext={dndContext}
        state={treeStateC}
      />
    </div> */}
  </div>
), root!);
