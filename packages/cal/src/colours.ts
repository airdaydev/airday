export type Theme = "light" | "dark";

export class RGBA {
  private _str: string | null = null;
  /**
   * Create an RGB color
   * @param r Red component (0-255)
   * @param g Green component (0-255)
   * @param b Blue component (0-255)
   * @param a Alpha component (0-1)
   */
  constructor(
    public r: number,
    public g: number,
    public b: number,
    public a: number = 1,
  ) {
    this.r = Math.round(Math.max(0, Math.min(255, r)));
    this.g = Math.round(Math.max(0, Math.min(255, g)));
    this.b = Math.round(Math.max(0, Math.min(255, b)));
    this.a = Math.max(0, Math.min(1, a));
  }

  /**
   * Creates an RGB instance from an array
   * @param rgb RGB values as [r, g, b] or [r, g, b, a]
   * @returns A new RGB instance
   */
  static fromArray(
    rgb: [number, number, number] | [number, number, number, number],
  ): RGBA {
    return rgb.length === 3
      ? new RGBA(rgb[0], rgb[1], rgb[2])
      : new RGBA(rgb[0], rgb[1], rgb[2], rgb[3]);
  }

  /**
   * Linear interpolation between two colors
   * @param color1 The start color
   * @param color2 The end color
   * @param t The interpolation factor (0-1)
   * @returns A new interpolated RGB color
   */
  static tween(color1: RGBA, color2: RGBA, t: number): RGBA {
    // Ensure t is between 0 and 1
    t = Math.max(0, Math.min(1, t));

    return new RGBA(
      color1.r + (color2.r - color1.r) * t,
      color1.g + (color2.g - color1.g) * t,
      color1.b + (color2.b - color1.b) * t,
      color1.a + (color2.a - color1.a) * t,
    );
  }

  /**
   * Boosts the RGB components by the specified amount
   * @param amount The amount to boost each RGB component by (default = 5)
   * @returns A new RGBA with boosted components
   */
  highlight(amount: number = 15): RGBA {
    return new RGBA(this.r + amount, this.g + amount, this.b + amount, this.a);
  }

  /**
   * Converts to CSS color string
   * @returns CSS color string in format 'rgba(r, g, b, a)'
   */
  toString(): string {
    if (this._str === null) {
      this._str = `rgba(${this.r}, ${this.g}, ${this.b}, ${this.a})`;
    }
    return this._str;
  }

  /**
   * Converts to array format
   * @returns RGBA values as [r, g, b, a]
   */
  toArray(): [number, number, number, number] {
    return [this.r, this.g, this.b, this.a];
  }
}

export interface ColourScheme {
  bg: RGBA;
  hzLine: RGBA;
  vtLine: RGBA;
  color: RGBA;
  labels: RGBA;
  shade: RGBA | string; // Kept as string for alpha values
  now: RGBA;
}

export const lightScheme: ColourScheme = {
  bg: new RGBA(255, 255, 255), // white
  color: new RGBA(0, 0, 0), // #000000
  labels: new RGBA(119, 119, 119), // #777
  hzLine: new RGBA(238, 238, 238), // #eee
  vtLine: new RGBA(221, 221, 221), // #ddd
  shade: new RGBA(247, 247, 247), // #f7f7f7
  now: new RGBA(247, 32, 75, 1),
};

export const darkScheme: ColourScheme = {
  bg: new RGBA(0, 0, 0), // black
  color: new RGBA(255, 255, 255), // #fff
  labels: new RGBA(119, 119, 119), // #777
  hzLine: new RGBA(34, 34, 34), // #222
  vtLine: new RGBA(34, 34, 34), // #222
  shade: new RGBA(17, 17, 17, 0.67), // Converted from "#111111aa"
  now: new RGBA(247, 32, 75, 1),
};

interface EventColorScheme {
  text: RGBA;
  bg: RGBA;
  fg: RGBA;
  shadow: RGBA; // Kept as string for alpha values
}

const yellowDark: EventColorScheme = {
  text: new RGBA(152, 136, 102),
  bg: new RGBA(64, 60, 48),
  fg: new RGBA(122, 106, 76),
  shadow: new RGBA(0, 0, 0, 0.02), // Converted from "#00000011"
};

// TODO: Fix LLM generated colours
const yellowLight: EventColorScheme = {
  text: new RGBA(89, 76, 48), // Darker yellow-brown for readable text
  bg: new RGBA(253, 248, 233), // Very light cream/yellow background
  fg: new RGBA(227, 208, 152), // Muted golden yellow foreground
  shadow: new RGBA(0, 0, 0, 0.067), // Same subtle shadow
};

const blueLight: EventColorScheme = {
  text: new RGBA(56, 84, 112), // Deeper pastel blue for text
  bg: new RGBA(241, 247, 253), // Soft sky blue background
  fg: new RGBA(176, 206, 233), // Gentle pastel blue foreground
  shadow: new RGBA(0, 0, 0, 0.067), // Same subtle shadow
};

const blueDark: EventColorScheme = {
  text: new RGBA(132, 156, 182), // Muted blue-gray for text
  bg: new RGBA(48, 56, 64), // Dark blue-gray background
  fg: new RGBA(76, 96, 116), // Darker muted blue foreground
  shadow: new RGBA(0, 0, 0, 0.067), // Same subtle shadow
};

interface EventSchemes {
  yellow: EventColorScheme;
  blue: EventColorScheme;
}

export const darkEventSchemes: EventSchemes = {
  yellow: yellowDark,
  blue: blueDark,
};

export const lightEventSchemes: EventSchemes = {
  yellow: yellowLight,
  blue: blueLight,
};
