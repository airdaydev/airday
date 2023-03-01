// Ported from react prototype

// PhantomStack is the component that shows a stack of currently
// dragged objects beneath the user's mouse
// we'll use RequestAnimationFrame to decide when to update the state

export const PhantomStack: FunctionComponent<{ size: number }> = ({ size }) => {
    // const [mousePos, setMousePos] = useState<[number, number]>([0, 0]);
    const [boardDimensions, setBoardDimensions] = useState<[number, number]>([document.body.scrollWidth, document.body.scrollHeight]);
    const stackRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        // Luckily, resize events should be very rare while dragging
        // This function allows draggable area to cover the entire document
        // without adding scrollbars. Scroll flash can be seen when using
        // keyboard to go fullscreen while dragging (NBD for now)
        // TODO: Safari: turn on user-select: none; for entire page!
        const onResize = (event: UIEvent) => requestAnimationFrame(() =>
            setBoardDimensions([document.body.scrollWidth, document.body.scrollHeight]));
        window.addEventListener('resize', onResize);
    })
    useEffect(() => {
        const onMouseMove = (event: MouseEvent) => {
            requestAnimationFrame(() => {
                if (stackRef.current) {
                    stackRef.current.style.left = `${window.scrollX + event.x}px`;
                    stackRef.current.style.top = `${window.scrollY + event.y}px`;
                }
            })
        };
        window.addEventListener('mousemove', onMouseMove);
        return () => window.removeEventListener('mousemove', onMouseMove);
    }, []);
    return (
        <div
            className={css`
            pointer-events: none;
            position: absolute;
            top: 0;
            left: 0;
            width: ${boardDimensions[0]}px;
            height: ${boardDimensions[1]}px;
            overflow: hidden;
        `}
        >
            <div
                ref={stackRef}
                className={css`
                    position: relative;
                    background: red;
                    width: 4em;
                    height: 4em;
                    z-index: 100;
                    top: -100%;
                    left: -100%;
                `}
            >
                {`${size} cards`}
            </div>
        </div>
    );
};
