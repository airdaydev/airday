// import { AirdayCal } from "../cal";

// This is a horizontal red line rendered in canvas to show today's across the screen, but will be replaced with DOM element in canvas rendering
// export function timeNow(airdayCal: AirdayCal) {
//   const ctx2D = airdayCal.ctx2D;
//   const now = new Date();
//   const y = airdayCal.transform.timeToY(now);
//   const nowCol = airdayCal.colourScheme.now.toString();
//   const nowHour = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")}`;
//   ctx2D.textAlign = "right";
//   ctx2D.textBaseline = "middle";
//   ctx2D.font = `${airdayCal.TIME_FONT_SIZE}px Alte Haas Grotesk`;
//   hzLine(airdayCal, y, { strokeStyle: nowCol, lineWidth: 0.5 });
//   ctx2D.fillStyle = nowCol;
//   ctx2D.fillText(
//     `${nowHour.toString()}`,
//     airdayCal.transform.gridOffset[0] - airdayCal.transform.margin,
//     y,
//   );
// }
