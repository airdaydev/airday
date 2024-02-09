import { Signal } from 'solid-js';
import { BaselineSticker } from './baseline'
import Smiley from '../stickers/baseline/smiley.svg';
import Triangle from '../stickers/baseline/triangle.svg';
import CircleTeal from '../stickers/baseline/circle-teal.svg';
import CirclePlaya from '../stickers/baseline/circle-playa.svg';
import styles from './sticker.module.css';

const map: Record<string, any> = {
  triangle: Triangle,
  smiley: Smiley,
  circleTeal: CircleTeal,
  circlePlaya: CirclePlaya,
};

interface StickerProps {
  set: 'baseline' | 'remote';
  item: Signal<BordeItem>;
}


// TODO: Retrieve id for updating etc
export const Sticker = (props: StickerProps) => {
  if (!props.item) return null;
  return (
    <span class={styles['sticker']}>
      {props.item[0]() && map[props.item[0]().sticker]}
    </span>
  );
}

    {/* if (props.set === 'baseline') {
        return <BaselineSticker  />
    }
    if (props.set === 'remote') {
        // TODO: Remote loader
        return null;
    }
    return null; */}
