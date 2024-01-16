import { JSXElement } from 'solid-js';
import { Modifiers, StickerDef, BaselineStickerDef, BaselineIcons } from './types';
import Smiley from '../stickers/baseline/smiley.svg';
import Triangle from '../stickers/baseline/triangle.svg';
import CircleTeal from '../stickers/baseline/circle-teal.svg';
import CirclePlaya from '../stickers/baseline/circle-playa.svg';

const map: Record<BaselineIcons | string, any> = {
    triangle: Triangle,
    smiley: Smiley,
    circleTeal: CircleTeal,
    circlePlaya: CirclePlaya,
};

// TODO: Improve typechecking
export const BaselineSticker = (props: string) => {
  console.log('sticker', props)
    const Icon = map[props.name];
    if (Icon) return <Icon style={"height: 1em; width: 1em;"} />
    return null;
}
