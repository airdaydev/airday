import { Accessor, Component, Ref } from "solid-js";
import { Node } from "./state";
import { TreeContext } from "./dnd-context";

export interface NodeProps {
  node: Node;
  Component: NodeComponentType<any>;
  windowIndex: Accessor<number>;
  projectionIndex: Accessor<number>;
  treeContext: TreeContext;
}

export const TreeNode = (props: NodeProps) => {
  let componentRef!: HTMLElement;
  function onDragStart(event: DragEvent) {
    if (event.dataTransfer) {
      event.dataTransfer.setData(
        "text/plain",
        props.treeContext.getSelectedNodeTextData(),
      );
    }
    const targetBounding = componentRef.getBoundingClientRect();
    const targetOffset = [
      event.pageX - targetBounding.x,
      event.pageY - targetBounding.y,
    ] as [number, number];
    props.treeContext.mousePosFrame(event);
    props.treeContext.dndContext.setCustomDragOpts(componentRef, targetOffset);
    props.treeContext.startDrag(props.windowIndex(), props.node);
    requestAnimationFrame(() => {
      if (componentRef?.parentElement)
        componentRef.parentElement.style.opacity = "0";
    });
    event.target?.addEventListener("dragend", () => {
      if (componentRef?.parentElement)
        componentRef.parentElement.style.opacity = "1";
      props.treeContext.stopDrag();
    });
    window.addEventListener(
      "drop",
      (event) => {
        event.preventDefault();
        if (componentRef?.parentElement)
          componentRef.parentElement.style.opacity = "1";
        const activeContext = props.treeContext.dndContext.dragContext[0]();
        activeContext?.dropItems(props.treeContext);
        props.treeContext.stopDrag();
      },
      { once: true },
    );
  }
  function onNodeMouseDown(event: MouseEvent, node: Node) {
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
      onMouseDown={(event) => onNodeMouseDown(event, props.node)}
      onDragStart={(event: DragEvent) => {
        onDragStart(event);
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

export type NodeComponentType<T extends Node> = Component<{
  node: T;
  ariaSelected: boolean;
  onDragStart: (event: DragEvent) => void;
  onMouseDown: (event: MouseEvent) => void;
  // onTouchStart: (event: TouchEvent) => void;
  select: () => void;
  ref: Ref<HTMLDivElement | undefined>;
  ctx: TreeContext;
  toggleExpansion: () => void;
}>;

export const DefaultNodeComponent: NodeComponentType<any> = (props) => {
  return (
    <div
      aria-selected={props.ariaSelected}
      onMouseDown={props.onMouseDown}
      // onTouchStart={props.onTouchStart}
    >
      {props.node.id}
    </div>
  );
};
