/**
 * Quickly check performance with this timer based on performance.now()
 * @param label An optional label that is display in the text
 * @returns a function to end the timer
 */
export function qperf(label?: string) {
  const start = performance.now();
  return () => {
    const end = performance.now();
    const time = new Date();
    const formattedTime = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}:${time.getSeconds().toString().padStart(2, "0")}:${time.getMilliseconds().toString().padStart(3, "0")}`;
    let str = `${formattedTime},${end - start}ms`;
    if (label) str += ` (${label})`;
    console.log(str);
  };
}
