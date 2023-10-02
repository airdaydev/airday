import { JSXElement } from 'solid-js';
import { Modifiers, StickerDef, BaselineStickerDef, BaselineIcons } from './types';

export type BaselineStickerBase = (sticker: BaselineStickerDef) => JSXElement;

const Triangle: BaselineStickerBase = (sticker: BaselineStickerDef) => (
    <svg></svg>
);
const Square: BaselineStickerBase = (sticker: BaselineStickerDef) => (
    <svg></svg>
);
const Circle: BaselineStickerBase = (sticker: BaselineStickerDef) => (
    <svg></svg>
);

const map: Record<BaselineIcons | string, BaselineStickerBase> = {
    tr: Triangle,
    sq: Square,
    ci: Circle,
};

// TODO: Improve typechecking
export const BaselineSticker = (sticker: StickerDef) => {
    const Icon = map[sticker.icon];
    if (Icon) return <Icon />
    return null;
}
