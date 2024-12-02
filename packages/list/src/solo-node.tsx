import { PropsWithChildren, Component } from "solid-js";
import { DndContext, TreeContext } from "./dnd-context";
import { distance } from "./utils";

interface SoloNodeProps extends PropsWithChildren {
  dndContext: DndContext;
  treeContext: TreeContext;
  Component: SoloNodeComponentType;
  enableDrop: boolean; // Can still be used with other components
  node: Node;
}

export type SoloNodeComponentType = Component<{
  node: Node;
  // ariaSelected: boolean;
  onMouseDown: (event: MouseEvent) => void;
  // onTouchStart: (event: TouchEvent) => void;
  // select: () => void;
  ctx: DndContext;
}>;

/**
 * SoloNode does not exist within a regular tree
 * but can be placed standalone
 * It can also form selection groups
 * It can hook itself into other drag contexts
 */
export const SoloNode = (props: SoloNodeProps) => {
  let ref!: HTMLElement;
  const enableDrop = props.enableDrop === false ? false : true;
  // Mouse interactions
  const onMouseDown = (event: MouseEvent) => {
    event.preventDefault(); // prevents selection on Safari
    props.dndContext.focusContext[1](null);
    const origin: [number, number] = [event.clientX, event.clientY];
    const mouseMove = (mouseMoveEvent: MouseEvent) => {
      event.preventDefault();
      // Make moving a little more effort to avoid slips
      if (
        distance(origin, [mouseMoveEvent.clientX, mouseMoveEvent.clientY]) > 3
      ) {
        if (enableDrop === false) props.dndContext.enableDrop = false;
        // const targetBounding = ref.getBoundingClientRect();
        // const targetOffset = [
        //   event.pageX - targetBounding.x,
        //   event.pageY - targetBounding.y,
        // ] as [number, number];
        // Start dragging
        props.dndContext.dragContext[1](null);
        props.dndContext.startDrag();
        window.removeEventListener("mousemove", mouseMove);
        window.addEventListener("mouseup", () => {
          props.dndContext.stopDrag();
        });
        window.removeEventListener("mousemove", mouseMove);
      }
    };
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", () => {
      props.dndContext.enableDrop = true;
      window.removeEventListener("mousemove", mouseMove);
    });
  };
  return (
    <div class="solo-item">
      <props.Component
        node={props.node}
        ctx={props.dndContext}
        ref={ref}
        onMouseDown={onMouseDown}
      />
    </div>
  );
};
