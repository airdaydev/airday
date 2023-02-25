export function jumpToElIfOutsideView(targetView: HTMLElement, node: Node) {
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const bounding = el.getBoundingClientRect();
    if (bounding.bottom > targetView.offsetHeight) {
        targetView.scrollTo(0, bounding.bottom - targetView.offsetHeight + targetView.scrollTop);
    }
    if (bounding.top < 0) {
        targetView.scrollTo(0, targetView.scrollTop + bounding.top);
    }
}