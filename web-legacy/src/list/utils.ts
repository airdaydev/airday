export function jumpToElIfOutsideView(targetView: HTMLElement, node: Node) {
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const bounding = el.getBoundingClientRect();
    const containerBounding = targetView.getBoundingClientRect();
    if (bounding.bottom > targetView.offsetHeight) {
        targetView.scrollTo(0, bounding.bottom - targetView.offsetHeight - containerBounding.top + targetView.scrollTop);
    }
    if (bounding.top < 0) {
        targetView.scrollTo(0, targetView.scrollTop + bounding.top - containerBounding.top);
    }
}

/**
 *
 * @param coordPairA [x: number, y: number]
 * @param coordPairB [x: number, y: number]
 * @returns distance between two coords (pythagora's theorem)
 */
export function distance(coordPairA: [number, number], coordPairB: [number, number]) {
    return Math.sqrt(Math.pow(coordPairB[0] - coordPairA[0], 2) + Math.pow(coordPairB[1] - coordPairA[1], 2));
}

export function moveCaretToPosition(el: HTMLInputElement, index: number) {
    el.selectionStart = index;
    el.selectionEnd = index;
}
