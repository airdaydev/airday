import {
  onCleanup,
  Component,
  Accessor,
  on,
  createEffect,
  createSignal,
  createMemo,
  onMount,
} from "solid-js";
import { Node } from "./state";
import { distance, isTouchDevice } from "./utils";
import "./root.css";
import { TreeContext, VirtualisedList } from "./dnd-context";
import { touchBandaid } from "./touch-bandaid";
import { Placeholder } from "./placeholder";
import { AutoscrollController } from "./autoscroll";

export interface NodeContainerProps {
  node: Node;
  Component: NodeComponentType;
  index: Accessor<number>;
  virtualisedList: VirtualisedList;
  treeContext: TreeContext;
  autoscroller: AutoscrollController;
}

export const NodeContainer = (props: NodeContainerProps) => {
  let ref: HTMLElement;
  const isSelected = () => props.treeContext.isSelected(props.node);
  const draggedOn = createSignal(0);
  const treeIndex = createMemo(
    () => props.virtualisedList().start + props.index(),
  );
  // Touch interactions
  let touchBandaidUnsub: () => void;
  onMount(() => {
    if (isTouchDevice()) {
      if (ref) touchBandaidUnsub = touchBandaid.onTouchEnter(ref, onUIEnter);
    }
  });
  onCleanup(() => {
    props.node.unsubscribe();
    if (touchBandaidUnsub) touchBandaidUnsub();
  });
  const onTouchStart = (event: TouchEvent) => {
    event.preventDefault();
    document.body.classList.add("touch-no-select"); // Prevent context menu
    props.treeContext.setLastTouchedIndex(treeIndex());
    ref.addEventListener(
      "touchend",
      () => {
        props.treeContext.stopDrag();
      },
      { once: true },
    );
    const startDrag = () => {
      const targetBounding = event.target.getBoundingClientRect();
      const targetOffset = [
        event.pageX - targetBounding.x,
        event.pageY - targetBounding.y,
      ] as [number, number];
      // Start dragging
      props.treeContext.startDrag(treeIndex(), props.node, ref, targetOffset);
    };
    const pullUpTimeout = setTimeout(() => {
      // TODO: add touching to classList (animated)
      props.treeContext.selectOne(props.node);
      props.treeContext.dndContext.moveDragCoords(
        event.touches[0].clientX,
        event.touches[0].clientY,
      ); // prevents flash
      let el: Element | null = null;
      ref.addEventListener("touchmove", (moveEvent) => {
        props.autoscroller.updateTouch(moveEvent); // TODO: Get it working with other lists
        props.treeContext.dndContext.moveDragCoords(
          moveEvent.touches[0].clientX,
          moveEvent.touches[0].clientY,
        );
        const nextEl = document.elementFromPoint(
          moveEvent.touches[0].clientX,
          moveEvent.touches[0].clientY,
        );
        if (nextEl === el) return;
        el = nextEl;
        if (el) {
          touchBandaid.call(el); // This simulates onEnter
          props.treeContext.dndContext.checkLeave(el); // This simulates onLeaveList
        }
      });
      startDrag();
    }, 250);
    event.preventDefault();
    document.addEventListener("touchend", () => {
      clearTimeout(pullUpTimeout);
      document.body.classList.remove("touch-no-select");
    });
  };
  // Mouse interactions
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    props.treeContext.setFocus();
    if (event.metaKey) {
      props.treeContext.toggleSelection(props.node, true);
      return;
    }
    // Shift key = range selection
    // TODO: Define shift key but nothing selected behaviour?
    if (event.shiftKey && props.treeContext.selection[0]().size) {
      const first = props.treeContext.getFirstIndexSelected();
      if (first === false) return; // no items found, TODO: how could this be the case?
      if (treeIndex() < first) {
        // shift up
        const last = props.treeContext.getLastIndexSelected();
        if (!last) return;
        props.treeContext.selectNodesInRange(treeIndex(), last);
      } else {
        // shift down
        props.treeContext.selectNodesInRange(first, treeIndex());
      }
      return;
    }
    if (!isSelected()) props.treeContext.selectOne(props.node);
    else {
      props.treeContext.originNode = props.node;
    }
    if (event.button === 2) {
      return;
    }
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseMoveEvent: MouseEvent) => {
      event.preventDefault();
      // Make moving a little more effort to avoid slips
      if (
        distance(origin, [mouseMoveEvent.clientX, mouseMoveEvent.clientY]) > 3
      ) {
        const targetBounding = event.target.getBoundingClientRect();
        const targetOffset = [
          event.pageX - targetBounding.x,
          event.pageY - targetBounding.y,
        ] as [number, number];
        // Start dragging
        props.treeContext.startDrag(treeIndex(), props.node, ref, targetOffset);
        window.removeEventListener("mousemove", mouseMove);
        window.addEventListener(
          "mouseup",
          () => {
            // Dropping an item
            // The event is on the node being dragged itself, but this is also recorded as selected item
            // We need to discover the parent, the local index
            // TODO: Perhaps wrap this within the context
            const activeContext = props.treeContext.dndContext.dragContext[0]();
            activeContext?.dropItems(props.treeContext);
            props.treeContext.stopDrag();
            window.removeEventListener("mousemove", mouseMove);
          },
          { once: true },
        );
      }
    };
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", () =>
      window.removeEventListener("mousemove", mouseMove),
    );
  };
  const isDragOrigin = createMemo(() => {
    props.treeContext.dndContext.isDragging(); // trigger
    return props.node === props.treeContext.originNode;
  });
  // Determines how the node reacts as a list item (typically, shifting up and down)
  // originIndex: index of the item being moved (or 0 in the case of foreign list)
  // index: current item's tree index
  // lastTouchedIndex: last hit by user
  createEffect(
    // TODO: only observer individual list is dragging!!
    on(
      () => [
        props.treeContext.lastTouchedIndexSignal[0](),
        props.treeContext.dndContext.isDragging(),
        props.treeContext.isDraggingOver(),
      ],
      ([lastTouchedIndex, isDragging, dragOver]) => {
        if (!isDragging) {
          draggedOn[1](0); // Turn off dragging state on local node, as user is not dragging at all
          return;
        }
        const index = treeIndex(); // the current index of the dragged item within the total filtered list
        const originIndex = props.treeContext.originIndex as number; // the drag origin
        if (!props.treeContext.isDragOrigin && dragOver) {
          if (index >= lastTouchedIndex) {
            draggedOn[1](-1);
          } else {
            draggedOn[1](0);
          }
          return;
        }
        // When dragging & leaving the origin list, the placeholder needs to disappear.
        // The placeholder could be part of the origin object, or covered by other objects
        // when the mouse is moved below or above.
        // Strategy: Everything below the origin object needs to have “above” class appended,
        // and no “below” classes need to be appended, when the list is not being hovered over.
        if (!dragOver && props.treeContext.isDragOrigin) {
          let result = 0;
          if (originIndex < index) result = 1;
          if (originIndex > index) result = 0;
          draggedOn[1](result);
          return;
        }
        // Drag origin (o) replaced with placeholder on initial drag.
        // Moving up, pushes o-1 down, exposing its placeholder.
        // Moving down, pushes o+1 up, exposing its placeholder.
        if (lastTouchedIndex === null) {
          draggedOn[1](0);
          return;
        }
        if (originIndex < index && lastTouchedIndex >= index) {
          // is below
          draggedOn[1](1);
          return;
        } else if (originIndex > index && lastTouchedIndex <= index) {
          draggedOn[1](-1);
          return;
        } else {
          draggedOn[1](0);
        }
      },
    ),
  );
  const onUIEnter = () => {
    // This looks at where the previous draggedOn index was, as its final position
    // is determined by whether the user drags up or down onto it.
    // N.b. the sequence here prevents a flicker on drag start.
    // TODO: Test if item can be dragged in here...
    const newIndex = treeIndex() - draggedOn[0]();
    const node = props.treeContext.projection()[newIndex];
    // if (node.depth > 1) {
    //   // document.body.style.cursor = "no-drop";
    //   return;
    // }
    if (node && node.depth <= props.node.maxDepth) {
      props.treeContext.setLastTouchedIndex(newIndex);
      props.treeContext.setDragOver();
    }
  };
  const childSelected = () => {
    if (props.treeContext.dndContext.isDragging()) {
      const index = props.treeContext.lastTouchedIndexSignal[0]();
      const node = props.virtualisedList().window[index];
      if (node && node.parent === props.node) {
        return true;
      }
    }
    return false;
  };
  /**
   * Hiding the placeholder:
   * We have 3 placeholders (up/down & origin)
   * Hide neutral when container is not actively being dragged over
   * Hide up when container is not actively being dragged over
   * Hide down when container is not actively being dragged over
   * Need to revert as if there's no above/below classes!
   */
  // padding-left: 31px;
  //   max-width: 100%;
  //   box-sizing: border-box;
  return (
    <div
      class="item"
      data-type="node"
      data-index={treeIndex()}
      style={{
        top: `${treeIndex() * props.treeContext.itemHeight}px`,
        height: `${props.treeContext.itemHeight}px`,
      }}
      aria-selected={isSelected()}
    >
      {draggedOn[0]() === -1 && <Placeholder debugText="above" />}
      {draggedOn[0]() === 1 &&
        props.treeContext.isDraggingOver() &&
        treeIndex() - Math.abs(props.treeContext.lastTouchedIndexSignal[0]()) <
          1 && <Placeholder debugText="below" />}
      {isDragOrigin() && props.treeContext.isDraggingOver() && (
        <Placeholder debugText="dragging-over" />
      )}
      {(!isDragOrigin() || !props.treeContext.dndContext.isDragging()) && (
        <div
          classList={{
            item_internal: true,
            above: draggedOn[0]() === 1,
            below: draggedOn[0]() === -1,
            animated: props.treeContext.dndContext.isDragging(),
          }}
          style={{}}
        >
          <props.Component
            onMouseDown={onMouseDown}
            onTouchStart={onTouchStart}
            onMouseEnter={onUIEnter}
            node={props.node}
            index={treeIndex()}
            ariaSelected={isSelected()}
            select={() => props.treeContext.selectOne(props.node)}
            ref={ref}
            ctx={props.treeContext}
            childSelected={childSelected()}
          />
        </div>
      )}
    </div>
  );
};

export type NodeComponentType = Component<{
  node: Node;
  ariaSelected: boolean;
  childSelected: boolean;
  onMouseDown: (event: MouseEvent) => void;
  onMouseEnter: (event: MouseEvent) => void;
  onTouchStart: (event: TouchEvent) => void;
  select: () => void;
  ctx: TreeContext;
}>;

export const DefaultNodeComponent: NodeComponentType = (props) => {
  return (
    <div
      aria-selected={props.ariaSelected}
      onMouseDown={props.onMouseDown}
      onTouchStart={props.onTouchStart}
      onMouseEnter={props.onMouseEnter}
    >
      {props.node.id}
    </div>
  );
};
