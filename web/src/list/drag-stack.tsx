import { createSignal, onCleanup, onMount } from 'solid-js';
// Ported from react prototype

// PhantomStack is the component that shows a stack of currently
// dragged objects beneath the user's mouse
// we'll use RequestAnimationFrame to decide when to update the state

// Show top 3 cards (small post-it note style) + total number of cards
// Sorted by top first

// TODO: Drag physics?
// https://greensock.com/forums/topic/16928-physics-while-dragging/

interface DragStackProps {
    size: number;
}

const [boardDimensions, setBoardDimensions] = createSignal<[number, number]>([document.body.scrollWidth, document.body.scrollHeight]);
const onResize = (event: UIEvent) => requestAnimationFrame(() =>
        setBoardDimensions([document.body.scrollWidth, document.body.scrollHeight]));

export const DragStack = ({ size }: DragStackProps) => {
    let stackRef: HTMLDivElement | undefined = undefined;
    const onMouseMove = (event: MouseEvent) => {
        requestAnimationFrame(() => {
            if (stackRef) {
                stackRef.style.left = `${window.scrollX + event.x}px`;
                stackRef.style.top = `${window.scrollY + event.y}px`;
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
        window.addEventListener('resize', onResize);
        window.addEventListener('mousemove', onMouseMove);
        onResize();
    })
    onCleanup(() => {
        window.removeEventListener('resize', onResize)
        window.removeEventListener('mousemove', onMouseMove)
    });
    return (
        <div
            style={`
            pointer-events: none;
            position: absolute;
            top: 0;
            left: 0;
            width: ${boardDimensions()[0]}px;
            height: ${boardDimensions()[1]}px;
            overflow: hidden;
        `}
        >
            <div
                ref={stackRef}
                style={`
                    position: relative;
                    background: var(--shade);
                    width: 12em;
                    height: 4em;
                    z-index: 100;
                    top: -100%;
                    left: -100%;
                    box-shadow: 1px 1px 2px #0000002e;
                    border-radius: 2px;
                    transform: rotateZ(2deg);
                `}
            >
                {`${size} cards`}
            </div>
        </div>
    );
};
