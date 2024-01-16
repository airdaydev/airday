import { createSignal, createEffect } from 'solid-js';
import MoonSVG from '../icons/moon.svg';
import SunSVG from '../icons/sun.svg';

function setTheme(name: string) {
  document.body.setAttribute('data-theme', name);
}

export const theme = createSignal<string>('light');

createEffect(() => {
  const themeVal = theme[0]();
  setTheme(themeVal);
}, theme);

interface ThemeToggleProps {
  class: string;
}

export const ThemeToggle = (props: ThemeToggleProps) => {
  let Icon = theme[0]() === 'dark' ? MoonSVG : SunSVG;
  return (
    <button
      class={props.class}
      onClick={() => {
        const newTheme = theme[0]() === 'dark' ? 'light' : 'dark';
        theme[1](newTheme);
      }}
    >
      {theme[0]() === 'dark' ? (
        <MoonSVG />
      ) : (
        <SunSVG />
      )}
    </button>
  );
}
