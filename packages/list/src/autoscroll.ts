/**
 * Class for controlling autoscroll as the user drags towards the bottom of a scroll container
 * TODO: Add linear easing function over initial .5s-.1s
 */
export class AutoscrollController {
  enabled = false;
  direction?: -1 | 1 | 0;
  scrollContainer?: HTMLElement;
  controlRangePx = 84;
  clientY = 0;
  // start when dragover === true
  curve = (y: number) => 18 * y ** 2 -7 * y + 1;
  start() {
    if (!this.scrollContainer) return;
    this.enabled = true;
    this.scrollContainer.addEventListener('mousemove', (event) => {
      this.clientY = event.clientY;
    });
    let lastFrame = performance.now();
    // TODO: Do nothing when reached bottom
    const nextFrame = () => requestAnimationFrame((timestamp) => {
      if (!this.scrollContainer) return;
      const rect = this.scrollContainer.getBoundingClientRect();
      const mouseY = this.clientY - rect.top;
      const d = this.curve((this.controlRangePx - mouseY) / this.controlRangePx);
      if (mouseY > rect.height - this.controlRangePx) {
        this.scrollContainer.scrollTo(0, this.scrollContainer.scrollTop + Math.ceil(d / (timestamp - lastFrame)));
      }
      if (mouseY < this.controlRangePx) {
        this.scrollContainer.scrollTo(0, this.scrollContainer.scrollTop + Math.ceil(d / (timestamp - lastFrame)));
      }
      lastFrame = timestamp;
      if (this.enabled) nextFrame();
    });
  }
  // stop when dragover === false
  stop() {
    this.enabled = false;
  }
}
