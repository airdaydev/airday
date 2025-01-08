const canvas = new OffscreenCanvas(100, 100);
const ctx2D = canvas.getContext("2d");

console.debug("event worker ready");

self.onmessage = (event: MessageEvent) => {
  if (event.data.type === "resize") {
    if (!ctx2D) throw new Error("offscreen ctx2d not ready");
    const [width, height, scale] = event.data.params;
    canvas.width = width;
    canvas.height = height;
    ctx2D.scale(scale, scale);
    ctx2D.fillStyle = "#cc44ff44";
    ctx2D.fillRect(0, 0, canvas.width, canvas.height);
    console.debug("resized, painted");
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ type: "frame", bitmap }, [bitmap]);
  }
  // const result = e.data[0] * e.data[1];
  // if (isNaN(result)) {
  //   postMessage("Please write two numbers");
  // } else {
  //   const workerResult = "Result: " + result;
  //   console.log("Worker: Posting message back to main script");
  //   postMessage(workerResult);
  // }
};
