import styles from "./list.module.css";
import TodoSVG from "../icons/list-icon-task.svg";
import BlueSVG from "../icons/list-icon-blue.svg";
import RedSVG from "../icons/list-icon-red.svg";
import ConcreteSVG from "../icons/list-icon-concrete.svg";
import FolderSVG from "../icons/folder.svg";

const icons = new Map([
  ["craft", BlueSVG],
  ["red", RedSVG],
  ["concrete", ConcreteSVG],
  ["task", TodoSVG],
  ["folder", FolderSVG],
]);

interface ListIconProps {
  container: AirContainer;
}

export const ListIcon = (props: ListIconProps) => {
  const iconText = props.container.icon;
  const icon = iconText && icons.get(iconText);
  const Icon = icon || TodoSVG;
  return <img src={Icon} class={styles["list-icon"]} />;
};
