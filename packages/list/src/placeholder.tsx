import { Show, useContext } from "solid-js";
import { ListDragContext, SolidListContext } from "./dnd-context";

export const Placeholder = (props: {
  backdrop?: boolean;
  debugText?: string;
}) => {
  const listDragContext = useContext<ListDragContext>(SolidListContext);
  return (
    <div
      classList={{
        placeholder: true,
        backdrop: props.backdrop,
        ...(listDragContext.placeholderStyle && {
          [listDragContext.placeholderStyle]: true,
        }),
      }}
      style={{
        "max-height": `${listDragContext.itemHeight}px`,
      }}
    >
      <Show when={!!props.debugText}>{props.debugText}</Show>
    </div>
  );
};
