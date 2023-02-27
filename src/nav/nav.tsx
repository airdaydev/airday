import styles from './nav.module.css';
import { replaceView } from '../view-state';
import TodoSVG from '../icons/todo.svg';

export function AcmeNav() {
  return (
    <nav class={styles.nav}>
        <button onClick={() => replaceView(0, 'acmelist')}>
          <span>Up Next</span>
        </button>
        <button>
          <span>Done</span>
        </button>
        <hr />
        <button>
          <TodoSVG />
          <span>Inbox</span>
        </button>
        <button>
          <TodoSVG />
          <span>Read</span>
        </button>
    </nav>
  );
}
