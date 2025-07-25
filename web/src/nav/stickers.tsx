import Sandbar from "../stickers/baseline/sand-bar.svg?component-solid";
import Triangle from "../stickers/baseline/triangle.svg?component-solid";
import CircleAqua from "../stickers/baseline/circle-aqua.svg?component-solid";
import CirclePink from "../stickers/baseline/circle-pink.svg?component-solid";
import CirclePlaya from "../stickers/baseline/circle-playa.svg?component-solid";
import Bunny from "../icons/bunny.png";
import styles from "./nav.module.css";

export const Stickers = () => (
  <section class={`${styles["nav-list"]} ${styles["sticker-nav"]}`}>
    <div>
      <button tabIndex={-1}>
        <Sandbar />
      </button>
      <button tabIndex={-1}>
        <Triangle />
      </button>
      <button tabIndex={-1}>
        <CircleAqua />
      </button>
      <button tabIndex={-1}>
        <CirclePink />
      </button>
      <button>
        <img src={Bunny} style="width: 1.5em;" />
      </button>
    </div>
  </section>
);
