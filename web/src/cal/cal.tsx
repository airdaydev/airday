import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { DataView } from "../view/state";
import { TreeContext, SolidListContext, Tree } from "@sunlist/list";
import itemStyles from "../item/item.module.css";
import styles from "./list.module.css";

/**
 * Initially, a weekly view.
 */
export const Calendar = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return <div>Calendar</div>;
};
