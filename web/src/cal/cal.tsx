import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { DataView } from "../view/state";
import { CalendarHeader } from "../list/list-header";
import { CalSolidWrapper } from "@airday/cal";

/**
 * Initially, a weekly view.
 */
export const Calendar = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return (
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%;">
      <CalendarHeader view={props.view} />
      <CalSolidWrapper />
    </div>
  );
};
