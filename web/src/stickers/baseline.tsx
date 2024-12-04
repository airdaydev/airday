import { JSXElement } from "solid-js";
import {
  Modifiers,
  StickerDef,
  BaselineStickerDef,
  BaselineIcons,
} from "./types";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CirclePink from "../stickers/baseline/circle-pink.svg?component-solid";
import Sandbar from "../stickers/baseline/sand-bar.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";

const map: Record<BaselineIcons | string, any> = {
  triangle: Triangle,
  circlePink: CirclePink,
  sandBar: Sandbar,
  circleAqua: CircleAqua,
};

interface BaselineStickerProps {
  name: string;
}

// TODO: Improve typechecking
export const BaselineSticker = (props: BaselineStickerProps) => {
  const Icon = map[props.name];
  if (Icon) return <Icon style={"height: 1em; width: 1em;"} />;
  return null;
};
