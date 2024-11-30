import { useContext, onMount, For, Component, Accessor } from "solid-js";
import styles from "./tree.module.css";
import { TreeContext, SolidListContext } from "./dnd-context";
import { TreeNode } from "./node";
import { Node } from "./state";

interface TreeProps {
  shadowColor: [number, number, number]; // RGB
}

export const Tree: Component<TreeProps> = (props) => {
  let listRef: HTMLDivElement | undefined = undefined;
  let tempItemRef: HTMLDivElement | undefined = undefined;
  let canvasRef: HTMLCanvasElement | undefined = undefined;
  const treeContext = useContext<TreeContext>(SolidListContext);
  const windowedList = treeContext.getWindowedSignal();

  onMount(() => {
    if (canvasRef && listRef) {
      treeContext.mount({
        canvasRef,
        listRef,
        treeContext,
        tempItemRef,
      });
      if (props.shadowColor) {
        treeContext.canvas.setShadowColor(props.shadowColor);
      }
    }
  });

  function getItemPosition(index: Accessor<number>, node: Node) {
    if (treeContext.refMap.get(node)?.preventAnimation) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const ref = treeContext.refMap.get(node);
          const newPos = treeContext.getItemPosition(windowedList, index);
          ref.ref?.style.setProperty("--pos", `${newPos}px`);
          treeContext.updateRef(node, { preventAnimation: false });
        });
      });
    }
    return `${treeContext.getItemPosition(windowedList, index, node)}px`;
  }

  return (
    <div class={styles["container"]}>
      <div class={styles["temp-container"]}>
        <div
          ref={tempItemRef}
          style={{ height: `${treeContext.itemHeight}px` }}
        ></div>
      </div>
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
                  const observer = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                      if (
                        mutation.type === "attributes" &&
                        mutation.attributeName === "style"
                      ) {
                        if (!mutation.target.style.getPropertyValue("--pos")) {
                          console.log(
                            "Style changed:",
                            mutation.target,
                            mutation.target.style,
                          );
                          console.trace();
                        }
                      }
                    });
                  });

                  observer.observe(ref, {
                    attributes: true,
                    attributeFilter: ["style"],
                  });
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
