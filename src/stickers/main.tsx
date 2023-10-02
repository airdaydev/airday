import { BaselineCSSStickers } from "./baseline-css"
import { Sticker } from "./types";

export const sticker = (sticker: Sticker) => {
    if (sticker.set === 'baseline-css') {
        if (!['triangle', 'square', 'circle'].includes((icon) => sticker.icon)) {
            // Invalid icon
        }
        const Icon = BaselineCSSStickers[sticker.icon];
        if (sticker.icon === 'triangle') {
            return <Baseline[sticker.icon] modifiers={sticker.modifiers} />
        }
        if (sticker.icon === 'square') {
            return <Square modifiers={sticker.modifiers} />
        }
        if (sticker.icon === 'Circle') {
            return <Square modifiers={sticker.modifiers} />
        }
    }
    if (sticker.set === 'baseline-svg') {
        if (sticker.icon)
    }
}

export const Smiley = (modifiers: Modifiers) => {};

// TODO: For all SVGs, resolve async from server