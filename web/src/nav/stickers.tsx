import Sandbar from '../stickers/baseline/sand-bar.svg?component-solid';
import Smiley from '../stickers/baseline/smiley.svg?component-solid';
import Triangle from '../stickers/baseline/triangle.svg?component-solid';
import CircleAqua from '../stickers/baseline/circle-aqua.svg?component-solid';
import CirclePink from '../stickers/baseline/circle-pink.svg?component-solid';
import CirclePlaya from '../stickers/baseline/circle-playa.svg?component-solid';
import styles from './nav.module.css';

export const Stickers = () => (
  <section class={`${styles['nav-list']} ${styles['sticker-nav']}`}>
    <div>
      <button>
        <Sandbar />
      </button>
      <button>
        <Smiley />
      </button>
      <button>
        <Triangle />
      </button>
      <button>
        <CircleAqua />
      </button>
      <button>
        <CirclePink />
      </button>
    </div>
  </section>
)
