import { Component, createSignal, useContext } from "solid-js";
import { NodeComponentType } from "@sunlist/list";
import { Checkbox } from "./checkbox";
import styles from "./item.module.css";
import { ItemContextMenu } from "./context-menu";
import { ListOptions, ListOptionsContext } from "../list/list-options";
import { GenericItem } from "../store/item";
import { Sticker } from "../stickers/main";

function formatDate(date: Date | undefined): string {
  if (!date) return "";
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
  };
  return date.toLocaleDateString("en-US", options);
}

const GenericItemCheckbox: Component<{
  node: GenericItem;
  options: ListOptions;
}> = (props) => {
  return (
    <Checkbox
      onChange={(event: InputEvent) => {
        props.node.toggleComplete(props.options.historical);
        event.stopPropagation();
      }}
      checked={!!props.node.accessor().tsDone}
    />
  );
};

const GenericItemDate: Component<{ node: GenericItem }> = (props) => {
  return (
    <span class={styles["date-col"]}>
      {formatDate(props.node.accessor().tsDone)}
    </span>
  );
};

const GenericItemContent: Component<{ node: GenericItem }> = (props) => {
  return (
    <span class={styles["content-col"]}>{props.node.accessor().content}</span>
  );
};

const GenericSticker: Component<{ node: GenericItem }> = (props) => {
  return (
    <span class={styles["sticker-col"]}>
      <Sticker set="baseline" item={props.node} />
    </span>
  );
};

const colMap = new Map<string, Component<{ node: GenericItem }>>([
  ["check", GenericItemCheckbox],
  ["date", GenericItemDate],
  ["content", GenericItemContent],
  ["sticker", GenericSticker],
]);

{
  /* <GenericItemCheckbox node={props.node} />
<span class={styles["date-col"]}>{formatDate(node().tsDone)}</span>
<span>{node().content}</span> */
}

export const GenericComponent: NodeComponentType = (props) => {
  const node = props.node.accessor;
  const options = useContext(ListOptionsContext);
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
          [styles["just-checked"]]: node().justChecked,
        }}
        onMouseDown={(event) => {
          props.onMouseDown(event);
        }}
        onDragStart={(event) => {
          props.onDragStart(event);
        }}
        draggable="true"
        // onTouchStart={(event) => {
        //   props.onTouchStart(event);
        // }}
        onDblClick={(event) => {
          event.preventDefault();
          props.select();
          // props.node.updateContent("gogogoo");
        }}
        onContextMenu={openContextMenu}
        data-index={props.index}
        ref={props.ref}
      >
        <For each={options.columns[0]()}>
          {(col) => {
            const Col = colMap.get(col);
            if (Col) {
              return <Col node={props.node} options={options} />;
            }
            return false;
          }}
        </For>
      </div>
      {ctxOpen() && (
        <ItemContextMenu
          close={() => setCtxOpen(false)}
          item={node()}
          offset={ctxOffset()}
          updateSticker={(sticker: string) => {
            props.node.updateSticker(sticker);
            setCtxOpen(false);
          }}
        />
      )}
    </>
  );
};
