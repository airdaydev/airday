import { onCleanup, onMount } from "solid-js";
import { DndContext } from "./dnd-context";

// NOTE: This was the original ghost before using native drag and drop
// TODO: Drag physics?
// TODO: Move back to original place if drop cancelled!
// https://greensock.com/forums/topic/16928-physics-while-dragging/

interface DraggedProps {
  dndContext: DndContext;
}

const defaultComponent = () => <div>Unset drag component</div>;

// TODO: This container could be replaced with DnD native API
// TODO: Advantage - automatical scroll when dragging
export const Dragged = ({ dndContext }: DraggedProps) => {
  let component = dndContext.draggedEl;
  if (!component) component = defaultComponent();
  let stackRef: HTMLDivElement | undefined = undefined;
  const onMouseMove = (event: MouseEvent) => {
    requestAnimationFrame(() => {
      if (stackRef) {
        stackRef.style.left = `${window.scrollX + event.x - dndContext.elClickOffset[0]}px`;
        stackRef.style.top = `${window.scrollY + event.y - dndContext.elClickOffset[1]}px`;
      }
    });
  };
  // For touch...?
  dndContext.onDragMove((coords) => {
    requestAnimationFrame(() => {
      if (stackRef) {
        stackRef.style.left = `${window.scrollX + coords[0] - dndContext.elClickOffset[0]}px`;
        stackRef.style.top = `${window.scrollY + coords[1] - dndContext.elClickOffset[1]}px`;
      }
    });
  });
  onMount(() => {
    // Luckily, resize events should be very rare while dragging
    // This function allows draggable area to cover the entire document
    // without adding scrollbars. Scroll flash can be seen when using
    // keyboard to go fullscreen while dragging (NBD for now)
    // TODO: Safari: turn on user-select: none; for entire page!
    stackRef.appendChild(component);
    // window.addEventListener('resize', onResize);
    window.addEventListener("mousemove", onMouseMove);
    // onResize();
  });
  onCleanup(() => {
    // window.removeEventListener('resize', onResize)
    window.removeEventListener("mousemove", onMouseMove);
  });
  return (
    <div
      style={`
      pointer-events: none;
      position: fixed;
      z-index: 10;
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
          z-index: 100;
          top: -100%;
          left: -100%;
          box-shadow: rgba(0, 0, 0, 0.05) 0px 3px 7px, rgba(0, 0, 0, 0.08) 0px 2px 2px;
          max-width: ${dndContext.elDimensionsPx[0]}px;
          height: ${dndContext.elDimensionsPx[1]}px;
          animation: scaleUp 0.15s ease-in-out forwards;
        `}
      ></div>
    </div>
  );
};
