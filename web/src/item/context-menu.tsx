import { ContextMenu } from "../context-menu/context-menu";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";
import Smiley from "../stickers/baseline/smiley.svg?component-solid";
import styles from "./item.module.css";
import { useContext } from "solid-js";
import { sessionContext } from "../store/context";

interface ItemContextMenuProps {
  close: () => void;
  item: Accessor<Sunlist>;
  updateSticker: (sticker: string) => void;
  style: string;
  offset: [number, number];
}

export function ItemContextMenu(props: ItemContextMenuProps) {
  const session = useContext(sessionContext);
  return (
    <ContextMenu close={props.close} style={props.style} offset={props.offset}>
      <button disabled>
        <span>Add to up next</span>
      </button>
      <button onClick={() => session.viewState.focusItem(props.item)}>
        <span>Focus</span>
      </button>
      <hr />
      <button disabled>
        <span>Copy text</span>
      </button>
      <button disabled>
        <span>Copy as JSON</span>
      </button>
      <button disabled>
        <span>Copy as Markdown</span>
      </button>
      <hr />
      <div class={styles["sticker-container"]}>
        <button onClick={() => props.updateSticker("smiley")}>
          <Smiley />
        </button>
        <button onClick={() => props.updateSticker("triangle")}>
          <Triangle />
        </button>
        <button onClick={() => props.updateSticker("circleAqua")}>
          <CircleAqua />
        </button>
        <button onClick={() => props.updateSticker(null)}>X</button>
      </div>
      <hr />
      <button disabled>
        <span>Duplicate</span>
      </button>
      <button disabled>
        <span>Delete</span>
      </button>
    </ContextMenu>
  );
}
