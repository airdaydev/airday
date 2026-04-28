import { ContextMenu } from "../context-menu/context-menu";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";
import styles from "./item.module.css";
import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { Key } from "../generic/key";
import { GenericItem } from "../store/item";

interface ItemContextMenuProps {
  close: () => void;
  item: GenericItem;
  updateSticker: (sticker: string) => void;
  offset?: [number, number];
}

export function ItemContextMenu(props: ItemContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu close={props.close} offset={props.offset}>
      <button disabled>
        <span>Add to next</span>
      </button>
      <button disabled>
        <span>Add date</span>
      </button>
      <button
        onClick={() => session.viewState.focusItem(props.item)}
        style="display: flex;
        justify-content: space-between;
        align-items: center;
        width: 12em;"
      >
        <span>Focus</span>
        <div>
          <Key key="⌥" />
          <Key key="F" />
        </div>
      </button>
      <hr />
      <button
        disabled
        style="display: flex;
      justify-content: space-between;
      align-items: center;
      width: 12em;"
      >
        <span>Copy</span>
        <div>
          <Key key="⌘" />
          <Key key="C" />
        </div>
      </button>
      <button disabled>
        <span>Copy special</span>
      </button>
      <hr />
      <div class={styles["sticker-container"]}>
        <button onClick={() => props.updateSticker("triangle")}>
          <Triangle />
        </button>
        <button onClick={() => props.updateSticker("circleAqua")}>
          <CircleAqua />
        </button>
      </div>
      <button onClick={() => props.updateSticker(null)}>Remove sticker</button>
      <hr />
      <button disabled>
        <span>Duplicate</span>
      </button>
      <button
        disabled
        style="display: flex;
    justify-content: space-between;
    align-items: center;
    width: 12em;"
      >
        <span>Delete</span>
        <div>
          <Key key="del" />
        </div>
      </button>
    </ContextMenu>
  );
}
