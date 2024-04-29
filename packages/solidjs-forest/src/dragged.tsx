import { createSignal, onCleanup, onMount } from 'solid-js';

// TODO: Drag physics?
// TODO: Move back to original place if drop cancelled!
// https://greensock.com/forums/topic/16928-physics-while-dragging/

interface DragStackProps {
    size: number;
}

const defaultComponent = () => <div>Unset drag component</div>;
// Maybe delete this implemenation, but possible it was done for a reason
// const [boardDimensions, setBoardDimensions] = createSignal<[number, number]>([document.body.scrollWidth, document.body.scrollHeight]);
// const onResize = () => requestAnimationFrame(() =>
//         setBoardDimensions([document.body.clientWidth, document.body.clientHeight]));

export const Dragged = ({ size, component, dragClickOffset }: DragStackProps) => {
    if (!component) component = defaultComponent();
    let stackRef: HTMLDivElement | undefined = undefined;
    const onMouseMove = (event: MouseEvent) => {
        requestAnimationFrame(() => {
            if (stackRef) {
                stackRef.style.left = `${window.scrollX + event.x - dragClickOffset[0]}px`;
                stackRef.style.top = `${window.scrollY + event.y - dragClickOffset[1]}px`;
            }
        })
    };
    // const [mousePos, setMousePos] = useState<[number, number]>([0, 0]);
    onMount(() => {
        // Luckily, resize events should be very rare while dragging
        // This function allows draggable area to cover the entire document
        // without adding scrollbars. Scroll flash can be seen when using
        // keyboard to go fullscreen while dragging (NBD for now)
        // TODO: Safari: turn on user-select: none; for entire page!
        stackRef.appendChild(component)
        // window.addEventListener('resize', onResize);
        window.addEventListener('mousemove', onMouseMove);
        // onResize();
    })
    onCleanup(() => {
        // window.removeEventListener('resize', onResize)
        window.removeEventListener('mousemove', onMouseMove)
    });
    return (
        <div
            style={`
            pointer-events: none;
            position: absolute;
            z-index: 10;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        `}
        >
            <div
                ref={stackRef}
                style={`
                    position: relative;
                    z-index: 100;
                    top: -100%;
                    left: -100%;
                    box-shadow: 1px 1px 2px #0000002e;
                    max-width: 16em;
                    height: 26px;
                `}
            >
            </div>
        </div>
    );
};
