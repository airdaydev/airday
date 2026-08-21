// Key-hint legend shared by the find and move palettes. Decorative (the
// bindings are documented in the shortcuts dialog), so hidden from AT.

import arrowsDownUpSvg from "./icons/arrows-down-up.svg?raw";
import { useAppI18n } from "./i18n.tsx";

export function PaletteFooter(props: {
  /** What Enter does here ("Open" / "Move"). */
  enterLabel: string;
}) {
  const { m } = useAppI18n();
  return (
    <div class="palette__footer" aria-hidden="true">
      <span class="palette__hint">
        <kbd class="menu-shortcut" innerHTML={arrowsDownUpSvg} />
        {m().find.hintSelect}
      </span>
      <span class="palette__hint">
        <kbd class="menu-shortcut">↵</kbd>
        {props.enterLabel}
      </span>
      <span class="palette__hint">
        <kbd class="menu-shortcut">esc</kbd>
        {m().find.hintClose}
      </span>
    </div>
  );
}
