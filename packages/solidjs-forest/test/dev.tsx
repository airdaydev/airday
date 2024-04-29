/* @refresh reload */
import { render } from 'solid-js/web';
import { Tree, TreeState, NodeComponentType, Node, GenericNode } from '../src/index';
import { dummyTree } from './dummy';
import styles from './main.module.css';


const root = document.getElementById('root');

// TODO: Allow file drag & drop via https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API
// We'll use this between TreeState to allow a shared selection state
// const context = new Context();

class TextNode extends Node {
  type = 'text';
  allowChildren = true;
  content?: string;
  component = TextNodeComponent;
  constructor(node) {
    super(node);
    this.content = node.content;
  }
  serialise() {
    return {
      content: this.content,
    };
  }
  updateContent(newText: string) {
    this.content = newText;
    this.triggerUpdate();
  }
}

function loader(node: GenericNode<any>) {
  return new TextNode({
    id: node.id,
    content: node.content,
  });
}

const TextNodeComponent: NodeComponentType = (props) => {
  const node = props.node.accessor;
  return (
    <div
      aria-selected={props.ariaSelected}
      class={styles['tree-item']}
      onMouseDown={(event) => {
        props.onMouseDown(event)
      }}
      onDblClick={(event) => {
        event.preventDefault();
        props.node.select();
        props.node.updateContent('gogogoo')
      }}
      ref={props.ref}
    >
      {node().id} - {node().content}
    </div>
  )
};

const treeStateA = new TreeState({
  loader,
  onSelectionChange: (nodeSet) => {
    // console.log('selectionChange', nodeSet.values().next().value);
  }
});
const data = dummyTree();
treeStateA.load(data);

render(() => (
  <div style={styles['container']}>
    <div>
      <h2>Tree A ({treeStateA.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        state={treeStateA}
        draggable
        multiselect
        height={(node) => {}} // Node height calculation function or number
      />
    </div>
    {/* <div>
      <h2>List B ({rootB.count()} items)</h2>
      <input type="text" placeholder="filter text" />
      <Tree
        state={rootB}
      />
    </div> */}
  </div>
), root!);
