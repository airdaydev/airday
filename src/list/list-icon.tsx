import TodoSVG from '../icons/nb-todo.svg';
import CuttingBoardSVG from '../icons/cutting-board.svg';
import FolioSVG from '../icons/folio.svg';
import InboxSVG from '../icons/inbox.svg';
import NotepadsSVG from '../icons/notepads.svg';

const icons = new Map([
  ['cutting-board', CuttingBoardSVG],
  ['folio', FolioSVG],
  ['notepads', NotepadsSVG],
  ['inbox', InboxSVG],
]);

interface ListIconProps {
  container: BordeContainer,
}

export const ListIcon = (props: ListIconProps) => {
  console.log(props.container);
  const iconText = props.container.icon;
  const icon = iconText && icons.get(iconText);
  const Icon = icon || TodoSVG;
  return (
    <Icon
      style={`display: block;flex-shrink: 0;height: 1.75rem;width: 1.75rem;`}
    />)
}
