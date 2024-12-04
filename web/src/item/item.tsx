import {
  Accessor,
  Component,
  createEffect,
  createSignal,
  For,
  onCleanup,
  Show,
  useContext,
} from "solid-js";
import { NodeComponentType } from "@sunlist/list";
import { Checkbox } from "./checkbox";
import styles from "./item.module.css";
import { ItemContextMenu } from "./context-menu";
import { ListOptions, ListOptionsContext } from "../list/list-options";
import { GenericItem } from "../store/item";
import { Sticker } from "../stickers/main";
import { sessionContext } from "../store/context";

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

const GenericItemContent: Component<{
  node: GenericItem;
  inlineEditing: Accessor<boolean>;
  endEdit: () => void;
}> = (props) => {
  let editableRef: HTMLElement | undefined;
  createEffect(() => {
    // Autofocus
    if (props.inlineEditing()) {
      editableRef.focus();
      window.addEventListener("mousedown", clickOutside);
    }
  });
  const clickOutside = (event: MouseEvent) => {
    if (!editableRef?.contains(event.target)) {
      props.node.updateContent(editableRef?.innerText);
      window.removeEventListener("mousedown", clickOutside);
      props.endEdit();
    }
  };
  return (
    <>
      <Show when={props.inlineEditing()}>
        <div
          class={styles["content-col-editable"]}
          contentEditable
          onLoad={() => {
            console.log("loaded");
          }}
          ref={editableRef}
        >
          {props.node.accessor().content}
        </div>
      </Show>
      <Show when={props.inlineEditing() === false}>
        <span class={styles["content-col"]} onDblClick={() => props.edit()}>
          {props.node.accessor().content}
        </span>
      </Show>
    </>
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

export const GenericComponent: NodeComponentType<GenericItem> = (props) => {
  const session = useContext(sessionContext);
  const [inlineEditing, setInlineEditing] = createSignal(false);
  const edit = () => {
    session.viewState.keyboard.disable();
    setInlineEditing(true);
  };
  const endEdit = () => {
    session.viewState.keyboard.enable();
    setInlineEditing(false);
  };
  onCleanup(() => {
    if (!session.viewState.keyboard.enabled)
      session.viewState.keyboard.enable();
  });
  const node = props.node.accessor;
  const options = useContext(ListOptionsContext);
  // ContextMenu
  const [ctxOpen, setCtxOpen] = createSignal<boolean>(false);
  const [ctxOffset, setCtxOffset] = createSignal<[number, number]>();
  function openContextMenu(event: MouseEvent) {
    if (inlineEditing()) return;
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
          if (!inlineEditing()) props.onMouseDown(event);
        }}
        onDragStart={(event) => {
          props.onDragStart(event);
        }}
        draggable={props.draggable}
        onTouchStart={(event) => {
          props.onTouchStart(event);
        }}
        onDblClick={(event) => {
          event.preventDefault();
          edit();
        }}
        onContextMenu={openContextMenu}
        data-index={props.index}
        ref={props.ref}
      >
        <For each={options.columns[0]()}>
          {(col) => {
            const Col = colMap.get(col);
            if (Col === GenericItemContent) {
              return (
                <Col
                  node={props.node}
                  options={options}
                  edit={edit}
                  endEdit={endEdit}
                  inlineEditing={inlineEditing}
                />
              );
            }
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
          item={props.node}
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
