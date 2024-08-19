import { Signal } from "solid-js";

/**
 *
 * @param coordPairA [x: number, y: number]
 * @param coordPairB [x: number, y: number]
 * @returns distance between two coords (pythagora's theorem)
 */
export function distance(
  coordPairA: [number, number],
  coordPairB: [number, number],
) {
  return Math.sqrt(
    Math.pow(coordPairB[0] - coordPairA[0], 2) +
      Math.pow(coordPairB[1] - coordPairA[1], 2),
  );
}

/**
 * Quickly check performance with this timer based on performance.now()
 * @param label An optional label that is display in the text
 * @returns a function to end the timer
 */
export function qperf(label?: string) {
  const start = performance.now();
  return () => {
    const end = performance.now();
    let str = `exec time: ${end - start}ms`;
    if (label) str += ` (${label})`;
    console.log(str);
  };
}

/**
 * Publishes live container height to signal
 * @param targetEl element
 * @param signal Signal<number> that publishes to
 * @returns observer (for clean up)
 */
export function observeHeight(targetEl: HTMLElement, signal: Signal<number>) {
  let previousHeight = targetEl.offsetHeight;

  function checkHeight() {
    const currentHeight = targetEl.offsetHeight;
    if (currentHeight !== previousHeight) {
      previousHeight = currentHeight;
      signal[1](currentHeight);
    }
  }

  const observer = new MutationObserver(checkHeight);

  observer.observe(targetEl, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });

  checkHeight();

  return observer;
}
