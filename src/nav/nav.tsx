import styles from './nav.module.css';
import { replaceView } from '../view-state';
import TodoSVG from '../icons/todo.svg';
import RepeatSVG from '../icons/repeat.svg';
import CheckSVG from '../icons/check.svg';

export function AcmeNav() {
  return (
    <nav class={styles.nav}>
        <button>
          <RepeatSVG />
          <span>Up Next</span>
        </button>
        <button>
          <CheckSVG />
          <span>Done</span>
        </button>
        <hr />
        <button onClick={() => replaceView(0, 'inbox')}>
          <TodoSVG />
          <span>Inbox</span>
        </button>
        <button onClick={() => replaceView(0, 'acmelist')}>
          <TodoSVG />
          <span>Read</span>
        </button>
        <button onClick={() => replaceView(0, 'empty-list')}>
          <TodoSVG />
          <span>Empty list</span>
        </button>
    </nav>
  );
}
