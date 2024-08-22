import { useContext } from "solid-js";
import { ListDragContext, SolidListContext } from "./dnd-context";

export const Placeholder = () => {
  const listDragContext = useContext<ListDragContext>(SolidListContext);
  return (
    <div
      classList={{
        placeholder: true,
        ...(listDragContext.placeholderStyle && {
          [listDragContext.placeholderStyle]: true,
        }),
      }}
      style={`max-height: ${listDragContext.itemHeight}px`}
    />
  );
};
