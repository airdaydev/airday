import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount } from 'solid-js';
import { TransitionGroup } from 'solid-transition-group';
import { TreeState } from './state';
import { GenericNode } from './tree-utils';
import { NodeContainer, NodeComponentType, DefaultNodeComponent } from './node';
import { DndContext, ListDragContext } from './dnd-context';
import { observeHeight } from './utils';
import { AutoscrollController } from './autoscroll';

interface TreeComponentProps {
  state: TreeState,
  defaultNodeComponent?: NodeComponentType,
  uncontrolledData?: GenericNode<any>;
  dndContext: DndContext;
  data: GenericNode<any>,
  itemHeight: number;
}

export type ContainerVector = [scrollHeight: number, scrollTop: number];

// Probably an important read
// https://github.com/solidjs/solid/discussions/366
export const Tree = (props: TreeComponentProps) => {
  let scrollContainerRef: HTMLDivElement | undefined;
  const heightSignal = createSignal<number>(500); // Scroll container height
  const scrollSignal = createSignal<number>(0); // Scroll position
  const autoscroller = new AutoscrollController();
  const containerVector = createMemo<ContainerVector>(() => {
    return [heightSignal[0](), scrollSignal[0]()];
  });
  let listDragContext = new ListDragContext(
    props.state, props.dndContext, props.itemHeight,
  );
  onMount(() => {
    if (!scrollContainerRef) return;
    observeHeight(scrollContainerRef, heightSignal);
    autoscroller.scrollContainer = scrollContainerRef;
    listDragContext.scrollContainerRef = scrollContainerRef;
  });

  createEffect(on(() => [
    listDragContext.dragOver[0](),
    listDragContext.dndContext.isDragging[0](),
  ], (val) => {
    if (val[0] && val[1]) {
      autoscroller.start();
    } else {
      autoscroller.stop();
    }
  }));
  
  const kbHandler = (event: KeyboardEvent) => {
    // only if focused on this ref!
    if (event.key === 'Backspace') {
      console.log('huhhh');
      props.state.delete(listDragContext.selection[0]());
    }
  };
  document.addEventListener('keyup', kbHandler)
  onCleanup(() => {
    document.removeEventListener('keydown', kbHandler)
  });
  // TODO: If nothing but height needed, only pass height from event. Too much
  // UI code bleeding into state file
  const signal = listDragContext.getWindowedSignal(containerVector);
  return (
    <>
      <div
        style={{
          display: 'flex',
          'flex-direction': 'column',
          position: 'relative',
          width: '18em',
          height: '100%',
          'z-index': 2,
          color: 'black',
          'overflow-y': props.dndContext.isDragging[0]() ? 'hidden' : 'scroll',
        }}
        ref={scrollContainerRef}
        onScroll={(event) => {
          // TODO: This should match the projection buffer
          if (Math.abs(scrollSignal[0]() - event.target.scrollTop) > (props.itemHeight * 10)) {
            scrollSignal[1](event.target.scrollTop)
          }
        }}
        onMouseLeave={() => listDragContext.leave()}
        >
          <div
            style={`position: relative;
              top: 0;
              left: 0;
              width: 100%;
              min-height: ${listDragContext.presentCount()() * props.itemHeight}px;`}
          >
            <TransitionGroup name="fade">
              <For each={signal().window}>
                {(node, index) => (
                  // TODO: Consider using context here instead
                  <NodeContainer
                    index={index}
                    autoscroller={autoscroller}
                    virtualisedList={signal}
                    node={node}
                    itemHeight={props.itemHeight}
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
                  // should overextend. Yes, this needs to be the
                  listDragContext.setLastTouchedIndex(signal().window.length + signal().start);
                  listDragContext.dragOver[1](true);
                } else {
                  listDragContext.dragOver[1](true);
                  listDragContext.setLastTouchedIndex(signal().window.length + signal().start);
                }
              }
            }}
          >
            <TransitionGroup name="fade">
              {listDragContext.dndContext.isDragging[0]() &&
                (listDragContext.lastTouchedIndexSignal[0]() === (signal().window.length + signal().start)) &&
                !listDragContext.isOrigin && (
                <div class="placeholder" style={`max-height: ${props.itemHeight}px`} />
              )}
            </TransitionGroup>
          </div>
        </div>
    </>
  );
};
