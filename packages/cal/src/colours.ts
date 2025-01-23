export type Theme = "light" | "dark";

export interface ColourScheme {
  bg: string;
  hzLine: string;
  vtLine: string;
  color: string;
  labels: string;
  shade: string;
}

export const lightScheme: ColourScheme = {
  bg: "white",
  color: "#000000",
  labels: "#777",
  hzLine: "#eee",
  vtLine: "#ddd",
  shade: "#f7f7f7",
};

export const darkScheme: ColourScheme = {
  bg: "black",
  color: "#fff",
  labels: "#777",
  hzLine: "#222",
  vtLine: "#222",
  shade: "#111111aa",
};

interface EventColorScheme {
  text: string;
  bg: string;
  fg: string;
  shadow: string;
}

const yellowDark: EventColorScheme = {
  text: "rgb(152 136 102)",
  bg: "rgb(64 60 48)",
  fg: "rgb(122 106 76)",
  shadow: "#00000011",
};

const blueDark: EventColorScheme = {
  text: "",
  bg: "",
  fg: "",
  shadow: "",
};

// TODO: Fix LLM generated colours
const yellowLight: EventColorScheme = {
  text: "rgb(89 76 48)", // Darker yellow-brown for readable text
  bg: "rgb(253 248 233)", // Very light cream/yellow background
  fg: "rgb(227 208 152)", // Muted golden yellow foreground
  shadow: "#00000011", // Same subtle shadow
};

export const darkEventSchemes = {
  yellow: yellowDark,
  blue: blueDark,
};

export const lightEventSchemes = {
  yellow: yellowLight,
  blue: blueDark,
};
