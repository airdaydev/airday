import { onCleanup, onMount } from "solid-js";
import { DndContext } from "./dnd-context";

// TODO: Drag physics? https://greensock.com/forums/topic/16928-physics-while-dragging/

interface DraggedProps {
  dndContext: DndContext;
}

const defaultComponent = () => <div>Unset drag component</div>;

export const Dragged = ({ dndContext }: DraggedProps) => {
  let component: HTMLElement =
    dndContext.customDragEl || (defaultComponent() as HTMLElement);
  let stackRef!: HTMLDivElement;
  const onMouseMove = (event: MouseEvent) => {
    requestAnimationFrame(() => {
      if (stackRef) {
        stackRef.style.left = `${window.scrollX + event.x - dndContext.customDragBounds[0]}px`;
        stackRef.style.top = `${window.scrollY + event.y - dndContext.customDragBounds[1]}px`;
      }
    });
  };
  // For touch...?
  dndContext.onDragMove((coords) => {
    requestAnimationFrame(() => {
      if (stackRef) {
        stackRef.style.left = `${window.scrollX + coords[0] - dndContext.customDragBounds[0]}px`;
        stackRef.style.top = `${window.scrollY + coords[1] - dndContext.customDragBounds[1]}px`;
      }
    });
  });
  onMount(() => {
    // TODO: Safari: turn on user-select: none; for entire page!
    stackRef.appendChild(component);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("dragover", onMouseMove);
  });
  onCleanup(() => {
    window.removeEventListener("mousemove", onMouseMove);
  });
  return (
    <div
      style={`
      pointer-events: none;
      position: fixed;
      z-index: 100;
      top: ${`${window.scrollY.toString()}px` || "0"};
      left: 0;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
    `}
    >
      <div
        ref={stackRef}
        class="dragged"
        style={`
          position: relative;
          top: -100%;
          left: -100%;
          max-width: ${dndContext.customDragBounds[2]}px;
          height: ${dndContext.customDragBounds[3]}px;
          box-shadow: 0 0 0 1px rgba(63, 63, 68, 0.05), 0 1px 3px 0 rgba(34, 33, 81, 0.15);
          animation: scaleUp 0.15s ease-in-out forwards;
          background: red;
        `}
      ></div>
    </div>
  );
};
