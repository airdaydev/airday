import { Component, createSignal, useContext } from "solid-js";
import { NodeComponentType } from "@sunlist/list";
import { Checkbox } from "./checkbox";
import styles from "./item.module.css";
import { ItemContextMenu } from "./context-menu";
import { ListOptionsContext } from "../list/list-options";
import { GenericItem } from "../store/loader";

function formatDate(date: Date | undefined): string {
  if (!date) return "";
  const options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
  };
  return date.toLocaleDateString("en-US", options);
}

const GenericItemCheckbox: Component<{ node: GenericItem }> = (props) => {
  return (
    <Checkbox
      onChange={(event: InputEvent) => {
        props.node.toggleComplete();
        event.stopPropagation();
      }}
      checked={!!props.node.tsCompleted}
    />
  );
};

const GenericItemDate: Component<{ node: GenericItem }> = (props) => {
  return (
    <span class={styles["date-col"]}>
      {formatDate(props.node.accessor().tsCompleted)}
    </span>
  );
};

const GenericItemContent: Component<{ node: GenericItem }> = (props) => {
  return (
    <span class={styles["content-col"]}>{props.node.accessor().content}</span>
  );
};

const colMap = new Map<string, Component<{ node: GenericItem }>>([
  ["check", GenericItemCheckbox],
  ["date", GenericItemDate],
  ["content", GenericItemContent],
]);

{
  /* <GenericItemCheckbox node={props.node} />
<span class={styles["date-col"]}>{formatDate(node().tsCompleted)}</span>
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
              return <Col node={props.node} />;
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
            // props.fastList.updateItemContents(item.id, { sticker });
            setCtxOpen(false);
          }}
        />
      )}
    </>
  );
};
