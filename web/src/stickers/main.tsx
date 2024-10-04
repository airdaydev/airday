import { Signal } from "solid-js";
import { BaselineSticker } from "./baseline";
import Smiley from "../stickers/baseline/smiley.svg?component-solid";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CirclePink from "../stickers/baseline/circle-pink.svg?component-solid";
import Sandbar from "../stickers/baseline/sand-bar.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";
import styles from "./sticker.module.css";

const map: Record<string, any> = {
  triangle: Triangle,
  smiley: Smiley,
  circlePink: CirclePink,
  sandBar: Sandbar,
  circleAqua: CircleAqua,
};

interface StickerProps {
  set: "baseline" | "remote";
  item: Signal<SunlistItem>;
}

// TODO: Retrieve id for updating etc
export const Sticker = (props: StickerProps) => {
  if (!props.item) return null;
  return (
    <span class={styles["sticker"]}>
      {props.item[0]() && map[props.item[0]().sticker]}
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
