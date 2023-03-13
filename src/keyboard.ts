const keyName = (event: string, contextId: string) =>
    `${event}:${contextId}`;

export class KeyboardShortcuts {
    handlerMap = new Map<string, (event: KeyboardEvent) => void>();
    globalHandlerActive = true;
    currentContext: string | null = null;
    enabled: boolean = true; // for temporarily overriding for example when editing
    constructor() {
        window.addEventListener('keydown', (event: KeyboardEvent) => {
            if (!this.enabled) return;
            // TODO: Make this actually work (competes with local listeners for now)
            if (this.globalHandlerActive) {
                const action = this.globalKeyboardHandler(event); // overrides
                if (action) return;
            }
            if (this.currentContext) {
                const handler = this.handlerMap.get(keyName('keydown', this.currentContext));
                if (handler) handler(event);
            }
        });
    }
    globalKeyboardHandler(event: KeyboardEvent) {
        return false;
    }
    registerHandler(event: string, contextId: string, handler: (event: KeyboardEvent) => void) {
        this.handlerMap.set(keyName(event, contextId), handler);
    }
    unregisterHandler(event: string, contextId: string) {
        this.handlerMap.delete(keyName(event, contextId));
    }
    setFocus(contextId: string) {
        this.currentContext = contextId;
    }
    disable() {
        this.enabled = false;
    }
    enable() {
        this.enabled = true;
    }
}

export const keyboardShortcuts = new KeyboardShortcuts();

// list gets its own context (open modal etc still works)
// item gets its own context (open modal etc still works)
// side nav gets its own context (open modal etc still works)
// modal gets its own context (takes over completely)

// the key is one context at a time, but with a global context that can be turned on/off
// falls back to first open context
