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
