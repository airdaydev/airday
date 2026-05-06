/** Probe OPFS availability by attempting to acquire the origin root.
 *  Firefox private windows expose `navigator.storage.getDirectory` but
 *  throw SecurityError when called; this collapses that into a boolean. */
export async function probeOpfs(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    if (!navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}
