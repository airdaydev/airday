import { For, onCleanup } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { GenericNode, TreeState } from './state';
import { NodeContainer, NodeComponentType, DefaultNodeComponent } from './node';
import { Dragged } from './dragged';

interface TreeComponentProps {
  state: TreeState,
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
      props.state.delete(props.state.selection);
    }
  };
  document.addEventListener('keyup', kbHandler)
  onCleanup(() => {
    document.removeEventListener('keydown', kbHandler)
  });
  return (
    <>
      {props.state.dragSignal[0]() && (
        <Dragged
          size={props.state.selection.size}
          component={props.state.dragEl}
          dragClickOffset={props.state.dragClickOffset}
        />
      )}
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
          <For each={props.state.getWindowedSignal(containerRef!)()}>
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
