import styles from "./list.module.css";
import TodoSVG from "../icons/list-icon-task.svg";
import CraftSVG from "../icons/list-icon-craft.svg";
import RedSVG from "../icons/list-icon-red.svg";
import SunSVG from "../icons/list-icon-sun.svg";
import ConcreteSVG from "../icons/list-icon-concrete.svg";

const icons = new Map([
  ["craft", CraftSVG],
  ["red", RedSVG],
  ["sun", SunSVG],
  ["concrete", ConcreteSVG],
  ["task", TodoSVG],
]);

interface ListIconProps {
  container: SunlistContainer;
}

export const ListIcon = (props: ListIconProps) => {
  const iconText = props.container.icon;
  const icon = iconText && icons.get(iconText);
  const Icon = icon || TodoSVG;
  return <img src={Icon} class={styles["list-icon"]} />;
};
