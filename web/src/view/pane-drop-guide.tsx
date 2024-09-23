import { createSignal } from "solid-js";
import styles from "./view.module.css";

export const PaneDropGuide = () => {
  const dynamicStyle = createSignal<string>("");
  return (
    <div
      onMouseOver={() => {
        dynamicStyle[1]("background: purple;");
      }}
      onMouseLeave={() => {
        dynamicStyle[1]("");
      }}
      class={styles["pane-drop-guide"]}
      style={dynamicStyle[0]()}
    />
  );
};
