export const defaultContainerWidth = 100000;
export const scale = () => window.devicePixelRatio || 1;

export function getCanvasContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const ctx2D =
    canvas instanceof HTMLCanvasElement
      ? (canvas.getContext("2d") as CanvasRenderingContext2D)
      : (canvas.getContext("2d") as OffscreenCanvasRenderingContext2D);
  if (!ctx2D) {
    throw new Error("Failed to retrieve canvas context");
  }
  return ctx2D;
}

export function resizeCanvas2D(canvas: HTMLCanvasElement) {
  canvas.width = canvas.offsetWidth * scale();
  canvas.height = canvas.offsetHeight * scale();
  const ctx2D = getCanvasContext(canvas);
  ctx2D.scale(scale(), scale());
}

function dimensions(canvas: HTMLCanvasElement) {
  if (!canvas)
    throw new Error("Attempted to get non-existent canvas dimensions");
  return [canvas.width / scale(), canvas.height / scale()];
}

export function clearCanvas(canvas: HTMLCanvasElement) {
  const canvasDimensions = dimensions(canvas);
  getCanvasContext(canvas).clearRect(
    0,
    0,
    canvasDimensions[0],
    canvasDimensions[1],
  );
}
