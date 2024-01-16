interface FocusProps {
  item: BordeItem;
}

// Full screen view with Pomodoro timer
// TODO: Change title of webpage to this
export const Focus = (props: FocusProps) => {
  return (
    <div>
      <h2>{props.item.text}</h2>
    </div>
  )
};
