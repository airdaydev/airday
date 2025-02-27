import { CalRenderer } from "../render";

// TODO: Start from interactions
export function interactions(renderer: CalRenderer) {
  const ctx2D = renderer.ctx2D;
  if (!renderer.hover) return;
  const [relDay, time] = renderer.hover;
  if (time < 0 || time > 25) return;
  const x =
    renderer.gridOffset[0] -
    renderer.transform.offset[0] +
    relDay * renderer.transform.dayPx;
  const y =
    time * renderer.transform.hourPx -
    renderer.transform.offset[1] +
    renderer.gridOffset[1];
  // ctx2D.fillStyle = "#00009944";
  // ctx2D.rect(x, y, renderer.transform.dayPx, 50);
  // ctx2D.fill();
  // Hits
  // ctx2D.beginPath();
  // renderer.uiObjects.hits.map((obj) => {
  //   // TODO: x offset!
  //   // TODO: clip!
  //   ctx2D.rect(
  //     x + obj.x,
  //     obj.y + renderer.gridOffset[1] - renderer.transform.offset[1],
  //     obj.width,
  //     obj.height,
  //   );
  // });
  // ctx2D.fill();
  // ctx2D.closePath();
  // const hit = renderer.uiObjects.hit;
  // if (hit) {
  //   ctx2D.beginPath();
  //   ctx2D.fillStyle = "#ff009944";
  //   ctx2D.rect(
  //     x + hit.x,
  //     hit.y + renderer.gridOffset[1] - renderer.transform.offset[1],
  //     hit.width,
  //     hit.height,
  //   );
  //   ctx2D.fill();
  //   ctx2D.closePath();
  // }
}
