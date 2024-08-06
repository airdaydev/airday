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
  curve = (y: number) => (12 * y ** 2) * (-7 * y) + 1;
  start() {
    console.log('starting');
    if (!this.scrollContainer) return;
    this.enabled = true;
    // TODO: Stop when inactive!
    this.scrollContainer.addEventListener('mousemove', (event) => {
      this.clientY = event.clientY;
    });
    let lastFrame = performance.now();
    // TODO: Do nothing when reached bottom
    const nextFrame = () => requestAnimationFrame((timestamp) => {
      if (!this.scrollContainer) return;
      const rect = this.scrollContainer.getBoundingClientRect();
      const mouseY = this.clientY - rect.top;
      console.log('mouseY', mouseY);
      const speed = this.curve((this.controlRangePx - mouseY) / this.controlRangePx);
      // Go up
      if (mouseY < this.controlRangePx) {
        if (this.scrollContainer.scrollTop !== 0) {
          console.log('going up', speed);
          const d = (this.scrollContainer.scrollTop - speed) / (timestamp - lastFrame);
          this.scrollContainer.scrollTo(0, d);
        }
      }
      // Go down
      if (mouseY > (rect.height - this.controlRangePx)) {
        if (this.scrollContainer.scrollTop !== this.scrollContainer.scrollHeight) {
          console.log('go down', (speed / (timestamp - lastFrame)));
          const d = (this.scrollContainer.scrollTop + speed) / (timestamp - lastFrame);
          this.scrollContainer.scrollTo(0, d);
        }
      }
      lastFrame = timestamp;
      if (this.enabled) nextFrame();
    });
    nextFrame();
  }
  stop() {
    console.log('stopping');
    this.enabled = false;
  }
}
