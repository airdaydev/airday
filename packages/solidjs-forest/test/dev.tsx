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
  // onSelectionChange: (nodeSet) => {
    // console.log('selectionChange', nodeSet.values().next().value);
  // }
});
treeStateA.load(dummyTree());

const treeStateB = new TreeState({ loader, dndContext });
treeStateB.load(dummyTree({ maxDepth: 1, maxChildren: 1 }));

render(() => (
  <div class={styles['container']}>
    {dndContext.isDragging[0]() && (
      <Dragged dndContext={dndContext} />
    )}
    <div>
      <h2>Tree A ({treeStateA.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        dndContext={dndContext}
        state={treeStateA}
        // draggable
        // multiselect
        // height={(node) => {}} // Node height calculation function or number
      />
    </div>
    <div>
      <h2>Tree B ({treeStateB.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        dndContext={dndContext}
        state={treeStateB}
      />
    </div>
  </div>
), root!);
