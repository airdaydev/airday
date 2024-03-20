import Smiley from '../stickers/baseline/smiley.svg';
import Triangle from '../stickers/baseline/triangle.svg';
import CircleTeal from '../stickers/baseline/circle-teal.svg';
import CirclePlaya from '../stickers/baseline/circle-playa.svg';
import styles from './nav.module.css';

export const Stickers = () => (
  <section class={`${styles['nav-list']} ${styles['sticker-nav']}`}>
    <div>
      <button>
        <Smiley />
      </button>
      <button>
        <Triangle />
      </button>
      <button>
        <CircleTeal />
      </button>
      <button>
        <CirclePlaya />
      </button>
    </div>
  </section>
)
