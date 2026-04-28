import { createSignal, createEffect } from "solid-js";
import MoonSVG from "../icons/moon.svg?component-solid";
import SunSVG from "../icons/sun.svg?component-solid";
import { RGB } from "@airday/list";

function setTheme(name: string) {
  document.body.setAttribute("data-theme", name);
}

export const theme = createSignal<string>("light");

createEffect(() => {
  const themeVal = theme[0]();
  setTheme(themeVal);
}, theme);

interface ThemeToggleProps {
  class: string;
}

export const canvasLightBg: RGB = [240, 240, 240];
export const canvasDarkBg: RGB = [39, 39, 45];

export const ThemeToggle = (props: ThemeToggleProps) => {
  let Icon = theme[0]() === "dark" ? MoonSVG : SunSVG;
  return (
    <button
      class={props.class}
      onClick={() => {
        const newTheme = theme[0]() === "dark" ? "light" : "dark";
        theme[1](newTheme);
      }}
      style={"line-height: 0rem;"}
      tabIndex={-1}
    >
      {theme[0]() === "dark" ? <MoonSVG /> : <SunSVG />}
    </button>
  );
};
