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
  const signal = listDragContext.getWindowedSignal();
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
          <div style={`position: relative;
            top: 0;
            left: 0;
            width: 100%;
            min-height: ${listDragContext.presentCount()() * 28}px;`}
          >
            <TransitionGroup name="fade">
              <For each={signal()}>
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
          </div>
          <div
            class='list-backdrop'
            onMouseEnter={() => {
              if (listDragContext.dndContext.isDragging[0]()) {
                if (listDragContext.isOrigin) {
                  // TODO: This COULD fuck up in the case of a window... but maybe not because the window
                  // should overextend.
                  listDragContext.setLastTouchedIndex(signal().length);
                  listDragContext.dragOver[1](true);
                } else {
                  listDragContext.dragOver[1](true);
                  listDragContext.setLastTouchedIndex(signal().length);
                }
              }
            }}
          >
            <TransitionGroup name="fade">
              {listDragContext.dndContext.isDragging[0]() && listDragContext.lastTouchedIndexSignal[0]() === signal().length &&
                !listDragContext.isOrigin && (
                <div class="placeholder" />
              )}
            </TransitionGroup>
          </div>
        </div>
    </>
  );
};
