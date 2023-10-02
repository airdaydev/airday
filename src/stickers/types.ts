// Keep it loose
export type Modifiers = Record<string, any>;

export interface StickerDef {
    set: 'baseline' | 'remote';
    icon: string;
    // modifiers
    m1?: string;
    m2?: string;
    m3?: string;
    m4?: string;
    m5?: string;
    m6?: string;
}

export type BaselineIcons = 'sq' | 'tr' | 'ci';

export interface BaselineStickerDef {
    set: 'baseline';
    icon: BaselineIcons;
}