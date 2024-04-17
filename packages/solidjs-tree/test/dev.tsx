/* @refresh reload */
import { Tree, RootNode, NodeComponent } from '../src/index';
import { render } from 'solid-js/web';
import { dummyTree } from './dummy';
import styles from './main.module.css';


const root = document.getElementById('root');

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between rootnodes to allow a shared selection state
// const context = new Context();

const rootA = new RootNode();
rootA.load(dummyTree());

const rootB = new RootNode();
rootB.load(dummyTree());

const Node: NodeComponent = (props) => {
  return (
    <div
      aria-selected={props.ariaSelected}
      class={styles['tree-item']}
      onMouseDown={props.onMouseDown}
    >
      {props.node.id}
    </div>
  )
}

const containerStyle = `
top: 0;
left: 0;
position: absolute;
width: 100%;
height: 100%;
display: flex;
justify-content: center;
align-items: center;`;

render(() => (
  <div style={containerStyle}>
    <div>
      <h2>List A ({rootA.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        rootNode={rootA}
        NodeComponent={Node}
        draggable
        multiselect
        // filter={(node: Node) => {
        //   node.
        // }}
        height={(node) => {}} // Node height calculation function or number
      />
    </div>
    <div>
      <h2>List B ({rootB.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        rootNode={rootB}
      />
    </div>
  </div>
), root!);
