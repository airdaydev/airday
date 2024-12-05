import { useContext } from "solid-js";
import { sessionContext } from "../store/context";
import { DataView } from "../view/state";
import { CalendarHeader } from "../list/list-header";

/**
 * Initially, a weekly view.
 */
export const Calendar = (props: { view: DataView }) => {
  const session = useContext(sessionContext);
  return (
    <div>
      <CalendarHeader view={props.view} />
    </div>
  );
};
