import { createSignal } from "solid-js";
import { NodeComponentType } from "@sunlist/list";
import { Checkbox } from "./checkbox";
import styles from "./item.module.css";
import { ItemContextMenu } from "./context-menu";

export const GenericComponent: NodeComponentType = (props) => {
  const node = props.node.accessor;
  // ContextMenu
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>();
  function openContextMenu(event: MouseEvent) {
    // TODO: Prevent shift key + context menu (too much work)
    event.preventDefault();
    if (event.target) {
      setCtxOffset([event.clientX, event.clientY]);
    }
    setCtxOpen(true);
    props.onMouseDown(event);
  }
  return (
    <>
      <div
        aria-selected={props.ariaSelected}
        classList={{
          [styles["tree-item"]]: true,
          [styles["focus"]]: props.ctx.isFocused(),
        }}
        onMouseDown={(event) => {
          props.onMouseDown(event);
        }}
        onTouchStart={(event) => {
          props.onTouchStart(event);
        }}
        onDblClick={(event) => {
          event.preventDefault();
          props.select();
          props.node.updateContent("gogogoo");
        }}
        onContextMenu={openContextMenu}
        data-index={props.index}
        ref={props.ref}
      >
        <Checkbox
          onChange={(event: InputEvent) => {
            props.node.toggleComplete();
            event.stopPropagation();
          }}
          checked={!!props.node.tsCompleted}
        />
        <span>{node().content}</span>
      </div>
      {ctxOpen() && (
        <ItemContextMenu
          close={() => setCtxOpen(false)}
          item={node()}
          offset={ctxOffset()}
          updateSticker={(sticker: string) => {
            // props.fastList.updateItemContents(item.id, { sticker });
            setCtxOpen(false);
          }}
        />
      )}
    </>
  );
};
