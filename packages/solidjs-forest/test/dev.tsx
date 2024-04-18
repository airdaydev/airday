/* @refresh reload */
import { render } from 'solid-js/web';
import { Tree, RootNode, NodeComponentType, Node, GenericNode } from '../src/index';
import { dummyTree } from './dummy';
import styles from './main.module.css';


const root = document.getElementById('root');

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between rootnodes to allow a shared selection state
// const context = new Context();

class TextNode extends Node {
  type = 'text';
  allowChildren = true;
  content?: string;
  constructor(node) {
    super(node);
    this.content = node.content;
  }
}

function loader(node: GenericNode<any>) {
  return new TextNode({ id: node.id, content: node.content });
}

const NodeComponent: NodeComponentType = (props) => {
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

const rootNode = new RootNode({
  loader,
  onSelectionChange: (nodeSet) => {
    console.log('selectionChange', nodeSet.values().next().value);
  }
});
const data = dummyTree();
rootNode.load(data);

render(() => (
  <div style={styles['container']}>
    <div>
      <h2>Tree A ({rootNode.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        rootNode={rootNode}
        NodeComponent={NodeComponent}
        draggable
        multiselect
        height={(node) => {}} // Node height calculation function or number
      />
    </div>
    {/* <div>
      <h2>List B ({rootB.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        rootNode={rootB}
      />
    </div> */}
  </div>
), root!);
