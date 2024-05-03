import { For, createUniqueId, onCleanup } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { GenericNode, TreeState } from './state';
import { NodeContainer, NodeComponentType, DefaultNodeComponent } from './node';
import { DndContext, ListDragContext } from './dnd-context';

interface TreeComponentProps {
  state: TreeState,
  defaultNodeComponent?: NodeComponentType,
  uncontrolledData?: GenericNode<any>;
  dndContext: DndContext;
  data: GenericNode<any>,
}

// Probably an important read
// https://github.com/solidjs/solid/discussions/366

export const Tree = (props: TreeComponentProps) => {
  let containerRef: HTMLDivElement | undefined;
  let listDragContext = new ListDragContext();
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
      <div
        ref={containerRef}
        x-forest-id={createUniqueId()}
        style={`
          position: relative;
          color: black;
          width: 18em;
          height: 25em;
          overflow-y: scroll;
        `}
        onMouseLeave={() => {
          // props.dndContext.setActiveContainer(null)
        }}
        >
        <TransitionGroup name="fade">
          <For each={props.state.getWindowedSignal(containerRef!, props.dndContext)()}>
            {(node, index) => (
              // TODO: Consider using context here instead
              <NodeContainer
                treeIndex={index}
                node={node}
                dndContext={props.dndContext}
                Component={node.component || props.defaultNodeComponent || DefaultNodeComponent}
                containerRef={containerRef}
                listDragContext={listDragContext}
              />
            )}
          </For>
        </TransitionGroup>
      </div>
    </>
  );
};
