import { useContext, onMount, For } from "solid-js";
import styles from "./tree.module.css";
import { TreeContext, SolidListContext } from "./dnd-context";
import { TreeNode } from "./node";

export const Tree = () => {
  let listRef: HTMLDivElement | undefined = undefined;
  let scrollRef: HTMLDivElement | undefined = undefined;
  let canvasRef: HTMLCanvasElement | undefined = undefined;
  const treeContext = useContext<TreeContext>(SolidListContext);
  const windowedList = treeContext.getWindowedSignal();

  onMount(() => {
    if (canvasRef && listRef) {
      treeContext.mount({
        canvasRef,
        listRef,
        treeContext,
        scrollRef,
      });
    }
  });

  return (
    <div class={styles["container"]}>
      <div
        classList={{
          [styles["list"]]: true,
          [styles["no-animation"]]: treeContext.noAnimation[0](),
        }}
        ref={listRef}
      >
        <div
          ref={scrollRef}
          style={{
            "min-height": `${treeContext.listHeight()}px`,
          }}
        >
          <For each={windowedList().window}>
            {(node, windowIndex) => (
              <div
                class={styles["item-container"]}
                style={{
                  top: `${treeContext.getItemPosition(windowedList, windowIndex)}px`,
                  height: `${windowIndex() === treeContext.presentCount() ? treeContext.itemHeight * 2 : treeContext.itemHeight}px`,
                }}
              >
                <TreeNode
                  node={node}
                  treeContext={treeContext}
                  Component={
                    node.component ||
                    props.defaultNodeComponent ||
                    DefaultNodeComponent
                  }
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
