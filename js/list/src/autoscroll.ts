export class Autoscroller2 {
  currentSpeed = 0;
  targetSpeed = 0;
  maxSpeed = 100; // pixels per second?
  accelerationTime = 50; // seconds to reach max speed
  decelerationTime = 20; // fixed time to slow to 0
  throttle = 0;
  scrollRef?: HTMLElement;
  enabled = false;
  direction: 1 | -1 = 1;
  subscriptions = new Map();
  constructor() {}
  mount(scrollRef: HTMLElement) {
    this.scrollRef = scrollRef;
  }
  curve(x: number) {
    return x ** 2;
  }
  setThrottle(throttle: number) {
    this.direction = throttle > 0 ? 1 : -1;
    this.throttle = Math.abs(throttle);
    if (!this.enabled) this.start();
  }
  update(deltaTime: number) {
    this.targetSpeed = this.maxSpeed * this.curve(this.throttle);

    if (this.targetSpeed > this.currentSpeed) {
      // Accelerating - smooth ease-in
      const accelerationRate = this.maxSpeed / this.accelerationTime;
      this.currentSpeed +=
        accelerationRate *
        deltaTime *
        (1 - this.currentSpeed / this.targetSpeed);
    } else {
      // Decelerating - fixed time deceleration
      const difference = this.targetSpeed - this.currentSpeed;
      this.currentSpeed += (difference / this.decelerationTime) * deltaTime;
    }
    if (this.scrollRef) {
      const relPos = this.currentSpeed * this.direction;
      this.scrollRef.scrollTop = this.scrollRef.scrollTop + relPos;
    }
    this.subscriptions.forEach((cb) => {
      cb();
    });
  }
  start() {
    this.enabled = true;
    if (!this.scrollRef) return;
    let lastFrame = performance.now();
    // TODO: Introduce acceleration
    const nextFrame = () =>
      requestAnimationFrame((timestamp) => {
        this.update(timestamp - lastFrame);
        lastFrame = timestamp;
        if (this.enabled) nextFrame();
      });
    nextFrame();
  }
  stop() {
    this.throttle = 0;
    this.enabled = false;
    this.subscriptions.clear();
  }
}
