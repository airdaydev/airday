import { AirdayCal } from "./render";

// Custom scrolling trial
export class CalScroller {
  airdayCal: AirdayCal;
  mode = "week"; // 'week' or 'day'
  animationDuration = 300; // ms
  scrollThreshold = 50; // px needed to trigger scroll
  isScrolling = false;
  startX = 0;
  startY = 0;
  scrollDelta = 0;
  lastTimestamp = 0;
  scrollDirection = null;
  constructor(airdayCal: AirdayCal) {
    this.airdayCal = airdayCal;
    this.airdayCal.canvas.addEventListener("wheel", this.handleWheel, {
      passive: false,
    });
    this.airdayCal.canvas.addEventListener("touchstart", this.handleTouchStart);
    this.airdayCal.canvas.addEventListener("touchmove", this.handleTouchMove);
    this.airdayCal.canvas.addEventListener("touchend", this.handleTouchEnd);
  }

  handleWheel(event: WheelEvent) {
    event.preventDefault();

    if (this.isScrolling) return;

    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

    if (Math.abs(delta) < this.scrollThreshold) return;

    this.scrollDirection = delta > 0 ? "next" : "prev";
    this.animateScroll();
  }

  handleTouchStart(event: TouchEvent) {
    if (this.isScrolling) return;

    const touch = event.touches[0];
    this.startX = touch.clientX;
    this.startY = touch.clientY;
    this.scrollDelta = 0;
    this.lastTimestamp = event.timeStamp;
  }

  handleTouchMove(event: TouchEvent) {
    if (this.isScrolling) {
      event.preventDefault();
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - this.startX;
    const deltaY = touch.clientY - this.startY;

    // Determine if scroll should be horizontal or vertical
    const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
    this.scrollDelta = isHorizontal ? deltaX : deltaY;

    // Calculate velocity
    const timeDelta = event.timeStamp - this.lastTimestamp;
    const velocity = Math.abs(this.scrollDelta) / timeDelta;

    // If scrolled past threshold with sufficient velocity
    if (Math.abs(this.scrollDelta) > this.scrollThreshold && velocity > 0.5) {
      this.scrollDirection = this.scrollDelta > 0 ? "prev" : "next";
      this.animateScroll();
      event.preventDefault();
    }

    this.lastTimestamp = event.timeStamp;
  }

  handleTouchEnd() {
    this.startX = 0;
    this.startY = 0;
    this.scrollDelta = 0;
  }

  animateScroll() {
    if (this.isScrolling) return;

    this.isScrolling = true;
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / this.animationDuration, 1);

      // Use easeOutCubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.isScrolling = false;
        this.onScrollComplete();
      }

      // Call update function with progress
      this.onScrollUpdate(eased, this.scrollDirection);
    };

    requestAnimationFrame(animate);
  }

  // Override these methods in your implementation
  onScrollUpdate(progress, direction) {
    // Example implementation:
    // const offset = direction === 'next' ? progress * width : -progress * width;
    // context.translate(offset, 0);
    // redrawCalendar();
  }

  onScrollComplete() {
    // Example implementation:
    // updateCurrentDate();
    // resetTransform();
    // redrawCalendar();
  }

  destroy() {
    this.airdayCal.canvas.removeEventListener("wheel", this.handleWheel);
    this.airdayCal.canvas.removeEventListener(
      "touchstart",
      this.handleTouchStart,
    );
    this.airdayCal.canvas.removeEventListener(
      "touchmove",
      this.handleTouchMove,
    );
    this.airdayCal.canvas.removeEventListener("touchend", this.handleTouchEnd);
  }
}
