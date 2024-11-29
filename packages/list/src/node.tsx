import { Accessor, Component } from "solid-js";
import { Node } from "./state";
import { TreeContext } from "./dnd-context";

export interface NodeProps {
  node: Node;
  Component: NodeComponentType;
  windowIndex: Accessor<number>;
  projectionIndex: Accessor<number>;
  treeContext: TreeContext;
}

function addDragStartEl(treeContext: TreeContext, element: HTMLElement) {
  const pos =
    element.parentElement.style.getPropertyValue("--pos").replace("px", "") -
    treeContext.listRef.scrollTop;
  treeContext.tempItemRef.style.top = `${pos}px`;
  if (treeContext.tempItemRef) {
    treeContext.tempItemRef.appendChild(element);
  }
}

function clearDragStartEl(tempItemRef: HTMLElement) {
  if (tempItemRef?.firstChild) {
    tempItemRef.removeChild(tempItemRef.firstChild);
  }
}

function putBack(element: HTMLElement, parent: HTMLElement) {
  if (parent) {
    parent.appendChild(element);
  }
}

export const TreeNode = (props: NodeProps) => {
  let containerRef: HTMLElement | undefined = undefined;
  let componentRef: HTMLElement | undefined = undefined;
  function onDragStart(event: DragEvent, node: Node) {
    requestAnimationFrame(() => {
      clearDragStartEl(props.treeContext.tempItemRef);
    });
    event.dataTransfer.setData(
      "text/plain",
      props.treeContext.getSelectedNodeTextData(),
    );
    props.treeContext.mousePosFrame(event);
    props.treeContext.startDrag(props.windowIndex(), props.node);
    event.target.addEventListener("dragend", (event) => {
      props.treeContext.stopDrag();
      clearDragStartEl(props.treeContext.tempItemRef);
    });
    window.addEventListener(
      "drop",
      (event) => {
        event.preventDefault();
        const activeContext = props.treeContext.dndContext.dragContext[0]();
        activeContext?.dropItems(props.treeContext);
        props.treeContext.stopDrag();
        clearDragStartEl(props.treeContext.tempItemRef);
      },
      { once: true },
    );
  }
  function mouseup() {
    putBack(componentRef, containerRef);
  }
  function onNodeMouseDown(event: MouseEvent, node: Node) {
    containerRef = componentRef.parentElement;
    window.addEventListener("mouseup", mouseup);
    // Slightly insane but avoids a world of pain.
    addDragStartEl(props.treeContext, componentRef);
    props.treeContext.setFocus();
    if (event.metaKey) {
      props.treeContext.toggleSelection(node, true);
    }

    // Shift key = range selection
    // TODO: Define shift key but nothing selected behaviour?
    if (event.shiftKey && props.treeContext.selection[0]().size) {
      event.preventDefault(); // prevents drag - too easy to slip
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
      onDragStart={(event: DragEvent) => {
        onDragStart(event, props.node, props.windowIndex());
      }}
      ariaSelected={isSelected()}
      select={() => props.treeContext.selectOne(props.node)}
      toggleExpansion={() => {
        props.node.toggleExpansion();
        props.treeContext.preventAnimationHack();
      }}
    />
  );
};

export type NodeComponentType = Component<{
  node: Node;
  ariaSelected: boolean;
  childSelected: boolean;
  onDragStart: (event: DragEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
  onMouseEnter: (event: MouseEvent) => void;
  onTouchStart: (event: TouchEvent) => void;
  select: () => void;
  ctx: TreeContext;
}>;
