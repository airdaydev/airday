import { Accessor, Component } from "solid-js";
import { Node } from "./state";
import { TreeContext, VirtualisedList } from "./dnd-context";
import { Coordinates, distance } from "./utils";

export interface NodeProps {
  node: Node;
  Component: NodeComponentType;
  windowIndex: Accessor<number>;
  projectionIndex: Accessor<number>;
  treeContext: TreeContext;
  // virtualisedList: VirtualisedList;
  // autoscroller: AutoscrollController;
}

export const TreeNode = (props: NodeProps) => {
  let componentRef: HTMLElement | undefined = undefined;
  function onNodeMouseDown(event: MouseEvent, node: Node) {
    event.preventDefault(); // Prevents selection
    props.treeContext.setFocus();
    if (event.metaKey) {
      props.treeContext.toggleSelection(node, true);
    }
    // Shift key = range selection
    // TODO: Define shift key but nothing selected behaviour?
    if (event.shiftKey && props.treeContext.selection[0]().size) {
      const first = props.treeContext.getFirstIndexSelected();
      if (first === false) return; // no items found, TODO: how could this be the case?
      if (props.projectionIndex() < first) {
        // shift up
        const last = props.treeContext.getLastIndexSelected();
        if (!last) return;
        props.treeContext.selectNodesInRange(props.projectionIndex(), last);
      } else {
        // shift down
        props.treeContext.selectNodesInRange(first, props.projectionIndex());
      }
      return;
    }
    if (!isSelected()) props.treeContext.selectOne(props.node);
    else {
      props.treeContext.originNode = props.node;
    }
    if (event.button === 2) {
      return; // context click handled elsewhere (TODO: ?)
    }
    const origin: Coordinates = [event.clientX, event.clientY];
    const bounds = componentRef?.getBoundingClientRect();
    let clickOffset = [0, 0];
    if (bounds) {
      clickOffset = [event.pageX - bounds.x, event.pageY - bounds.y];
    }
    const mouseMove = (moveEvent) => {
      if (distance(origin, [moveEvent.clientX, moveEvent.clientY]) > 3) {
        props.treeContext.mousePosFrame(moveEvent);
        props.treeContext.startDrag(
          props.windowIndex(),
          props.node,
          componentRef,
          clickOffset,
        );
        window.removeEventListener("mousemove", mouseMove);
      }
    };
    window.addEventListener("mousemove", mouseMove);
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
  const isSelected = () => props.treeContext.isSelected(props.node);
  return (
    <props.Component
      ref={componentRef}
      node={props.node}
      ctx={props.treeContext}
      onMouseDown={(event) =>
        onNodeMouseDown(event, props.node, props.windowIndex())
      }
      ariaSelected={isSelected()}
      select={() => props.treeContext.selectOne(props.node)}
    />
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
