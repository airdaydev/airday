import { BaselineSticker } from './baseline'
import { StickerDef } from './types';

interface StickerProps {
  set: 'baseline' | 'remote';
  name: string;
}

// TODO: Retrieve id for updating etc
export const Sticker = (props: StickerDef) => {
    if (props.set === 'baseline') {
        return <BaselineSticker name={props.name} />        
    }
    if (props.set === 'remote') {
        // TODO: Remote loader
        return null;
    }
    return null;
}
