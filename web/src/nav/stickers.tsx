import Smiley from '../stickers/baseline/smiley.svg';
import Triangle from '../stickers/baseline/triangle.svg';
import CircleTeal from '../stickers/baseline/circle-teal.svg';
import CirclePlaya from '../stickers/baseline/circle-playa.svg';
import styles from './nav.module.css';

export const Stickers = () => (
  <section class={`${styles['nav-list']} ${styles['sticker-nav']}`}>
    <h2 style='font-size: 1rem; font-weight: 600; padding: 0 0.5em;'>
      Stickers
    </h2>
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