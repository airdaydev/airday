// Keep it loose
export type Modifiers = Record<string, any>;

export interface Sticker {
    set: 'css' | 'svg' | 'remote-svg';
    icon: string;
    modifiers: Modifiers;
}
