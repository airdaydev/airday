import { For, onCleanup } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { GenericNode, RootNode } from './state';
import { NodeContainer, NodeComponentType, DefaultNodeComponent } from './node';
import { Dragged } from './dragged';

interface TreeComponentProps {
  rootNode: RootNode,
  defaultNodeComponent?: NodeComponentType,
  uncontrolledData?: GenericNode<any>;
  data: GenericNode<any>,
}

// Probably an important read
// https://github.com/solidjs/solid/discussions/366

export const Tree = (props: TreeComponentProps) => {
  let containerRef: HTMLDivElement | undefined;
  const kbHandler = (event: KeyboardEvent) => {
    // only if focused on this ref!
    if (event.key === 'Backspace') {
      props.rootNode.delete(props.rootNode.selection);
    }
  };
  document.addEventListener('keyup', kbHandler)
  onCleanup(() => {
    document.removeEventListener('keydown', kbHandler)
  });
  return (
    <>
      {props.rootNode.dragSignal[0]() && <Dragged size={props.rootNode.selection.size} />}
      <div
        ref={containerRef}
        style={`
          position: relative;
          color: black;
          width: 18em;
          height: 25em;
          overflow-y: scroll;
        `}
        >
        <TransitionGroup name="fade">
          <For each={props.rootNode.getWindowedSignal(containerRef!)()}>
            {(node, index) => (
              <NodeContainer
                treeIndex={index}
                node={node}
                Component={node.component || props.defaultNodeComponent || DefaultNodeComponent}
              />
            )}
          </For>
        </TransitionGroup>
      </div>
    </>
  );
};
