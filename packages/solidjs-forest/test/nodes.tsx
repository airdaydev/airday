import styles from './dev.module.css';
import {
  NodeComponentType, Node, GenericNode,
} from '../src/index';

export class TextNode extends Node {
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

export function loader(node: GenericNode<any>) {
  return new TextNode({
    id: node.id,
    content: node.content,
  });
}

export const TextNodeComponent: NodeComponentType = (props) => {
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
        props.select();
        props.node.updateContent('gogogoo')
      }}
      ref={props.ref}
    >
      {node().id} - {node().content}
    </div>
  )
};
