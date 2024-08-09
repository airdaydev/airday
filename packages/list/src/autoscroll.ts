/**
 * Class for controlling autoscroll as the user drags towards the bottom of a scroll container
 * TODO: Add linear easing function over initial .5s-.1s
 * https://www.desmos.com/calculator/zukjgk9iry
 * y=ax^{3}+bx+c
 */
export class AutoscrollController {
  enabled = false;
  direction?: -1 | 1 | 0;
  scrollContainer?: HTMLElement;
  controlRangePx = 84;
  clientY = 0;
  curve = (x: number) => 0.95 * x ** 2;
  updateMouse = (event: MouseEvent) => { this.clientY = event.clientY }
  updateTouch = (event: TouchEvent) => { this.clientY = event.touches[0].clientY }
  start() {
    if (!this.scrollContainer) return;
    this.enabled = true;
    this.scrollContainer.addEventListener('mousemove', this.updateMouse);
    let lastFrame = performance.now();
    // TODO: Introduce acceleration
    const nextFrame = () => requestAnimationFrame((timestamp) => {
      if (!this.scrollContainer) return;
      const rect = this.scrollContainer.getBoundingClientRect();
      const mouseY = this.clientY - rect.top;
      // Go up
      if (mouseY < this.controlRangePx) {
        if (this.scrollContainer.scrollTop !== 0) {
          // TODO: Introduce acceleration
          const throttle = Math.abs(this.controlRangePx - mouseY) / this.controlRangePx;
          const velocity = this.curve(throttle) * this.controlRangePx ** 1.5;
          const y = (this.scrollContainer.scrollTop) - velocity / (timestamp - lastFrame);
          this.scrollContainer.scrollTo(0, y);
        }
      }
      // Go down
      if (mouseY > (rect.height - this.controlRangePx)) {
        if (this.scrollContainer.scrollTop !== this.scrollContainer.scrollHeight) {
          const throttle = Math.abs(rect.height - mouseY - this.controlRangePx) / this.controlRangePx;
          const velocity = this.curve(throttle) * this.controlRangePx ** 1.5;
          const y = (this.scrollContainer.scrollTop) + velocity / (timestamp - lastFrame);
          this.scrollContainer.scrollTo(0, y);
        }
      }
      lastFrame = timestamp;
      if (this.enabled) nextFrame();
    });
    nextFrame();
  }
  stop() {
    this.enabled = false;
    this.scrollContainer?.removeEventListener('mousemove', this.updateMouse);
  }
}
