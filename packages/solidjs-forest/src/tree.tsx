import { For, onCleanup, onMount } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { TreeState } from './state';
import { GenericNode } from './tree-utils';
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
  let listDragContext = new ListDragContext(props.state, props.dndContext);
  onMount(() => listDragContext.setContainer(containerRef as HTMLDivElement));
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
        style={`
          display: flex;
          flex-direction: column;
          position: relative;
          width: 18em;
          height: 25em;
          z-index: 2;
          color: black;
          overflow-y: scroll;
        `}
        onMouseLeave={() => listDragContext.leave()}
        >
          <TransitionGroup name="fade">
            <For each={listDragContext.getWindowedSignal()()}>
              {(node, index) => (
                // TODO: Consider using context here instead
                <NodeContainer
                  treeIndex={index}
                  node={node}
                  Component={node.component || props.defaultNodeComponent || DefaultNodeComponent}
                  listDragContext={listDragContext}
                />
              )}
            </For>
          </TransitionGroup>
          {/* TODO: Possibly only necessary on foreign dragover */}
          {/* End spacer can be used to house foreign placeholder */}
          <div
            class='list-backdrop'
            onMouseOver={() => {
              console.log('list-backdrop');
              if (listDragContext.dragOver[0]()) {
                console.log('isOrigin', listDragContext.isOrigin);
              }
            }}
          />
        </div>
    </>
  );
};
