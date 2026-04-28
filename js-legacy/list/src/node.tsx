import { Accessor, Component, Ref } from "solid-js";
import { Node } from "./state";
import { TreeContext } from "./dnd-context";
import { distance } from "./utils";

export interface NodeProps {
  node: Node;
  Component: NodeComponentType<any>;
  windowIndex: Accessor<number>;
  projectionIndex: Accessor<number>;
  treeContext: TreeContext;
}

export const TreeNode = (props: NodeProps) => {
  let componentRef!: HTMLElement;
  function startCustomDrag(event: MouseEvent) {
    if (!componentRef) return;
    const targetBounding = componentRef.getBoundingClientRect();
    const targetBounds = [
      event.pageX - targetBounding.x,
      event.pageY - targetBounding.y,
      targetBounding.width,
      targetBounding.height,
    ] as [number, number, number, number];
    props.treeContext.dndContext.setCustomDragOpts(
      componentRef.cloneNode(true) as HTMLElement,
      targetBounds,
    );
    props.treeContext.mousePosFrame(event);
    props.treeContext.startDrag(props.windowIndex(), props.node);
  }
  function endDrag(drop = false) {
    if (componentRef?.parentElement)
      componentRef.parentElement.style.opacity = "1";
    if (drop) {
      const activeContext = props.treeContext.dndContext.dragContext[0]();
      activeContext?.dropItems(props.treeContext);
    }
    props.treeContext.stopDrag();
  }
  function onNativeDragStart(event: DragEvent) {
    if (event.dataTransfer) {
      event.dataTransfer.setData(
        "text/plain",
        props.treeContext.getSelectedNodeTextData(),
      );
    }
    props.treeContext.mousePosFrame(event);
    props.treeContext.startDrag(props.windowIndex(), props.node);
    const escToEndNative = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        componentRef.dispatchEvent(new DragEvent("dragend"));
      }
    };
    window.addEventListener("keydown", escToEndNative);
    requestAnimationFrame(() => {
      if (componentRef?.parentElement)
        componentRef.parentElement.style.opacity = "0";
    });
    componentRef.addEventListener("dragend", () => endDrag(false));
    window.addEventListener(
      "drop",
      (event) => {
        event.preventDefault();
        endDrag(true);
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
      return;
    }
    if (props.treeContext.dndContext.mode[0]() === "native") return;
    event.preventDefault(); // prevent selection (esp. on Safari)
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseMoveEvent: MouseEvent) => {
      event.preventDefault();
      // Make moving a little more effort to avoid slips
      if (
        distance(origin, [mouseMoveEvent.clientX, mouseMoveEvent.clientY]) > 3
      ) {
        // Start dragging
        startCustomDrag(event);
        const escToEndCustom = (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") {
            window.removeEventListener("mousemove", mouseMove);
            endDrag(false);
          }
        };
        if (componentRef?.parentElement)
          componentRef.parentElement.style.opacity = "0";
        window.addEventListener("keydown", escToEndCustom, { once: true });
        window.removeEventListener("mousemove", mouseMove);
        window.addEventListener(
          "mouseup",
          () => {
            endDrag(true);
            window.removeEventListener("mousemove", mouseMove);
            window.removeEventListener("keydown", escToEndCustom);
          },
          { once: true },
        );
      }
    };
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", () =>
      window.removeEventListener("mousemove", mouseMove),
    );
  }
  const isSelected = () => props.treeContext.isSelected(props.node);
  return (
    <props.Component
      ref={(ref) => {
        if (!ref) throw new Error("undefined componentRef");
        componentRef = ref;
      }}
      node={props.node}
      ctx={props.treeContext}
      onMouseDown={(event) => onNodeMouseDown(event, props.node)}
      onDragStart={(event: DragEvent) => {
        onNativeDragStart(event);
      }}
      draggable={props.treeContext.dndContext.mode[0]() === "native"}
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
  draggable: boolean;
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
