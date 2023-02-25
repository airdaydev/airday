export function jumpToElIfOutsideView(targetView: HTMLElement, node: Node) {
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const bounding = el.getBoundingClientRect();
    const viewportTop = window.scrollY;
    const viewportBottom = window.scrollY + targetView.offsetHeight
    if (bounding.bottom > targetView.offsetHeight) {
        console.log(`scrolling to ${bounding.bottom + window.scrollY - targetView.offsetHeight}`)
        targetView.scrollTo(0, bounding.bottom + window.scrollY - targetView.offsetHeight)
    }
    if (bounding.top < viewportTop) {
        console.log('its above!')
    }
}