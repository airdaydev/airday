import { Signal } from "solid-js";
import { BaselineSticker } from "./baseline";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CirclePink from "../stickers/baseline/circle-pink.svg?component-solid";
import Sandbar from "../stickers/baseline/sand-bar.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";
import styles from "./sticker.module.css";
import { GenericItem } from "../store/item";

const map: Record<string, any> = {
  triangle: Triangle,
  circlePink: CirclePink,
  sandBar: Sandbar,
  circleAqua: CircleAqua,
};

interface StickerProps {
  set: "baseline" | "remote";
  item: GenericItem;
}

// TODO: Retrieve id for updating etc
export const Sticker = (props: StickerProps) => {
  // console.log(props.item);
  if (!props.item) return null;
  return (
    <span class={styles["sticker"]}>
      {props.item.accessor().sticker && map[props.item.accessor().sticker]}
      {/* {props.item[0]() && props.item[0]().sticker} */}
    </span>
  );
};

{
  /* if (props.set === 'baseline') {
        return <BaselineSticker  />
    }
    if (props.set === 'remote') {
        // TODO: Remote loader
        return null;
    }
    return null; */
}
