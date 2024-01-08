import { createSignal, createEffect } from 'solid-js';
import MoonSVG from '../icons/moon.svg';
import SunSVG from '../icons/sun.svg';

function setTheme(name: string) {
  document.body.setAttribute('data-theme', name);
}

export const theme = createSignal<string>('dark');

createEffect(() => {
  const themeVal = theme[0]();
  setTheme(themeVal);
}, theme);

export const ThemeToggle = () => {
  let Icon = theme[0]() === 'dark' ? MoonSVG : SunSVG;
  return (
    <button
      style="background: none; border: none; cursor: pointer;"
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
