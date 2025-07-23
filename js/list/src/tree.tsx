import { onMount, For, Component, Accessor } from "solid-js";
import styles from "./tree.module.css";
import { useTreeContext } from "./dnd-context";
import { TreeNode } from "./node";
import { Node } from "./state";

interface TreeProps {
  shadowColor?: [number, number, number]; // RGB
}

export const Tree: Component<TreeProps> = (props) => {
  let listRef: HTMLDivElement | undefined = undefined;
  let canvasRef: HTMLCanvasElement | undefined = undefined;
  const treeContext = useTreeContext();
  const windowedList = treeContext.getWindowedSignal();

  onMount(() => {
    if (canvasRef && listRef) {
      treeContext.mount({
        canvasRef,
        listRef,
      });
      if (props.shadowColor) {
        treeContext.canvas?.setShadowColor(props.shadowColor);
      }
    }
  });

  function getItemPosition(index: Accessor<number>, node: Node) {
    if (treeContext.refMap.get(node)?.preventAnimation) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const ref = treeContext.refMap.get(node);
          const newPos = treeContext.getItemPosition(windowedList, index);
          ref?.ref?.style.setProperty("--pos", `${newPos}px`);
          treeContext.updateRef(node, { preventAnimation: false });
        });
      });
    }
    return `${treeContext.getItemPosition(windowedList, index, node)}px`;
  }

  return (
    <div
      class={styles["container"]}
      style={{
        height: treeContext.fitContent
          ? `${treeContext.listHeight()}px`
          : undefined,
        "min-height": `${treeContext.itemHeight * 2}px`,
      }}
    >
      <div
        classList={{
          [styles["list"]]: true,
          [styles["no-animation"]]: treeContext.noAnimation[0](),
        }}
        ref={listRef}
      >
        <div
          style={{
            position: "relative",
            "min-height": `${treeContext.listHeight()}px`,
          }}
        >
          <For each={windowedList().window}>
            {(node, windowIndex) => (
              <div
                class={styles["item-container"]}
                aria-selected={treeContext.isSelected(node)}
                style={{
                  "--pos": getItemPosition(windowIndex, node),
                  height: `${treeContext.itemHeight}px`,
                }}
                ref={(ref) => {
                  treeContext.updateRef(node, { ref });
                  // TODO: is this necessary?
                }}
              >
                <TreeNode
                  node={node}
                  treeContext={treeContext}
                  Component={node.component}
                  projectionIndex={() => windowIndex() + windowedList().start}
                  windowIndex={windowIndex}
                />
              </div>
            )}
          </For>
        </div>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
};
