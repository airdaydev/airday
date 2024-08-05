import { onCleanup, onMount } from 'solid-js';
import { DndContext } from './dnd-context';

// TODO: Drag physics?
// TODO: Move back to original place if drop cancelled!
// https://greensock.com/forums/topic/16928-physics-while-dragging/

interface DraggedProps {
    dndContext: DndContext;
}

const defaultComponent = () => <div>Unset drag component</div>;

// TODO: This container could be replaced with DnD native API
// TODO: Advantage - automatical scroll when dragging
export const Dragged = ({ dndContext }: DraggedProps) => {
    let component = dndContext.draggedEl;
    if (!component) component = defaultComponent();
    let stackRef: HTMLDivElement | undefined = undefined;
    const onMouseMove = (event: MouseEvent) => {
        requestAnimationFrame(() => {
            if (stackRef) {
                stackRef.style.left = `${window.scrollX + event.x - dndContext.elClickOffset[0]}px`;
                stackRef.style.top = `${window.scrollY + event.y - dndContext.elClickOffset[1]}px`;
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
            top: ${`${window.scrollY.toString()}px` || '0'};
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
                    max-width: 18em;
                    height: 26px;
                    // scale: 1;
                `}
            >
            </div>
        </div>
    );
};
