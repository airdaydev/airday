// import { AirdayCal } from "../cal";

// TODO: Start from interactions
// export function interactions(airdayCal: AirdayCal) {
//   const ctx2D = airdayCal.ctx2D;
//   if (!airdayCal.hover) return;
//   const [relDay, time] = airdayCal.hover;
//   if (time < 0 || time > 25) return;
//   const x =
//     airdayCal.transform.gridOffset[0] -
//     airdayCal.transform.offset[0] +
//     relDay * airdayCal.transform.dayPx;
//   const y =
//     time * airdayCal.transform.hourPx -
//     airdayCal.transform.offset[1] +
//     airdayCal.transform.gridOffset[1];
// Show 50px block beneath mouse pointer aligned to day
// ctx2D.fillStyle = "#00009944";
// ctx2D.rect(x, y, airdayCal.transform.dayPx, 50);
// ctx2D.fill();
// Hits
// ctx2D.beginPath();
// airdayCal.uiObjects.hits.map((obj) => {
//   // TODO: x offset!
//   // TODO: clip!
//   ctx2D.rect(
//     x + obj.x,
//     obj.y + airdayCal.transform.gridOffset[1] - airdayCal.transform.offset[1],
//     obj.width,
//     obj.height,
//   );
// });
// ctx2D.fill();
// ctx2D.closePath();
// const hit = airdayCal.uiObjects.hit;
// if (hit) {
//   ctx2D.beginPath();
//   ctx2D.fillStyle = "#ff009944";
//   ctx2D.rect(
//     x + hit.x,
//     hit.y + airdayCal.transform.gridOffset[1] - airdayCal.transform.offset[1],
//     hit.width,
//     hit.height,
//   );
//   ctx2D.fill();
//   ctx2D.closePath();
// }
// }
