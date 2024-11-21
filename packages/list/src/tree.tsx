import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  useContext,
} from "solid-js";
import { TreeState } from "./state";
import { GenericNode } from "./tree-utils";
import { NodeContainer, NodeComponentType, DefaultNodeComponent } from "./node";
import { DndContext, ListDragContext, SolidListContext } from "./dnd-context";
import { observeHeight } from "./utils";
import { AutoscrollController } from "./autoscroll";
import { Placeholder } from "./placeholder";

interface TreeComponentProps {
  state: TreeState;
  defaultNodeComponent?: NodeComponentType;
  uncontrolledData?: GenericNode<any>;
  dndContext: DndContext;
  data: GenericNode<any>;
  itemHeight: number;
  hideBackdrop?: boolean;
  additionalClasses?: Record<string, boolean>;
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
  const listDragContext = useContext<ListDragContext>(SolidListContext);
  onMount(() => {
    if (!scrollContainerRef) return;
    observeHeight(scrollContainerRef, heightSignal);
    autoscroller.scrollContainer = scrollContainerRef;
    listDragContext.scrollContainerRef = scrollContainerRef;
  });

  // Conditions:
  // 1. Dragging over the parent list
  // 2. The last item touched is the the last item in the signal????
  // 3. The parent list is not the origin (the extra space at the bottom
  // is only needed on foreign mouseovers!)
  const showBackdropPlaceholder = () => {
    const show =
      listDragContext.isDraggingOver() &&
      listDragContext.lastTouchedIndexSignal[0]() ===
        signal().window.length + signal().start &&
      !listDragContext.isOrigin;
    return show;
  };

  createEffect(
    on(
      () => [
        listDragContext.isDraggingOver(),
        listDragContext.dndContext.isDragging(),
      ],
      (val) => {
        if (val[0] && val[1]) {
          autoscroller.start();
        } else {
          autoscroller.stop();
        }
      },
    ),
  );

  const kbHandler = (event: KeyboardEvent) => {
    // only if focused on this ref!
    if (event.key === "Backspace") {
      listDragContext.treeState.delete(listDragContext.selection[0]());
    }
  };
  document.addEventListener("keyup", kbHandler);
  onCleanup(() => {
    document.removeEventListener("keydown", kbHandler);
  });
  // TODO: If nothing but height needed, only pass height from event. Too much
  // UI code bleeding into state file
  const signal = listDragContext.getWindowedSignal(containerVector);
  return (
    <div
      classList={{
        focus: listDragContext.isFocused(), // TODO: Do better
        ...props.additionalClasses,
      }}
      style={{
        display: "flex",
        "flex-direction": "column",
        position: "relative",
        width: "100%",
        height: "100%",
        "z-index": 2,
        "overflow-y":
          listDragContext.dndContext.dragMode[0]() === "touch"
            ? "hidden"
            : "scroll", // Only inactive for touch, so that scrollbar does not appear when toggling on Mac (possibly other OSs)
      }}
      ref={scrollContainerRef}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
        }
      }}
      onScroll={(event) => {
        // TODO: This should match the projection buffer
        if (
          Math.abs(scrollSignal[0]() - event.target.scrollTop) >
          listDragContext.itemHeight * 10
        ) {
          scrollSignal[1](event.target.scrollTop);
        }
      }}
      onFocus={() => listDragContext.setFocus()}
      onMouseLeave={() => listDragContext.leave()}
      tabIndex={-1}
    >
      <div
        style={`position: relative;
              top: 0;
              left: 0;
              width: 100%;
              min-height: ${listDragContext.presentCount() * listDragContext.itemHeight}px;`}
      >
        <For each={signal().window}>
          {(node, projectionIndex) => (
            // TODO: Consider using context here instead
            <NodeContainer
              index={projectionIndex}
              autoscroller={autoscroller}
              virtualisedList={signal}
              node={node}
              Component={
                node.component ||
                props.defaultNodeComponent ||
                DefaultNodeComponent
              }
              listDragContext={listDragContext}
            />
          )}
        </For>
      </div>
      <div
        class="list-backdrop"
        style={{
          "min-height": `${listDragContext.itemHeight * 2}px`,
          ...(props.hideBackdrop && {
            bottom: 0,
            position: "absolute",
            "min-height": `${listDragContext.itemHeight}px`,
          }),
        }}
        onMouseDown={() => {
          listDragContext.clearSelection();
          listDragContext.setFocus();
        }}
        onMouseEnter={() => {
          if (listDragContext.dndContext.isDragging()) {
            listDragContext.setDragOver();
            const endIndex = signal().window.length + signal().start;
            if (listDragContext.isOrigin) {
              listDragContext.setLastTouchedIndex(endIndex);
              listDragContext.setDragOver();
            } else {
              listDragContext.setDragOver();
              listDragContext.setLastTouchedIndex(endIndex);
            }
          }
        }}
      >
        {showBackdropPlaceholder() && <Placeholder backdrop={true} />}
      </div>
    </div>
  );
};
