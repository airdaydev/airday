import { useContext, onMount, For } from "solid-js";
import styles from "./tree.module.css";
import { TreeContext, SolidListContext } from "./dnd-context";
import { TreeNode } from "./node";

export const Tree = () => {
  let canvasRef: HTMLCanvasElement | undefined = undefined;
  let listRef: HTMLDivElement | undefined = undefined;
  let interactionsRef: HTMLDivElement | undefined = undefined;
  const treeContext = useContext<TreeContext>(SolidListContext);
  const windowedList = treeContext.getWindowedSignal();

  onMount(() => {
    if (canvasRef && listRef && interactionsRef) {
      treeContext.mount({
        canvasRef,
        listRef,
        interactionsRef,
        treeContext,
      });
    }
  });

  return (
    <div class={styles["container"]}>
      <div class={styles["interactions"]} ref={interactionsRef} />
      <div class={styles["list"]} ref={listRef}>
        <For each={windowedList().window}>
          {(node, windowIndex) => (
            <div
              class={styles["item-container"]}
              style={{
                top: `${treeContext.getItemPosition(windowedList, windowIndex)}px`,
                height: `${treeContext.itemHeight}px`,
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
      <canvas ref={canvasRef} />
    </div>
  );
};
