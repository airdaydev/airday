import { BaselineSticker } from './baseline'
import { StickerDef } from './types';

// TODO: Retrieve id for updating etc
export const sticker = (sticker: StickerDef) => {
    if (sticker.set === 'baseline') {
        return <BaselineSticker sticker={sticker} />        
    }
    if (sticker.set === 'remote') {
        // TODO: Remote loader
        return null;
    }
    return null;
}
