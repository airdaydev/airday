import styles from './nav.module.css';
import { replaceView } from '../view-state';

export function AcmeNav() {
  return (
    <nav class={styles.nav}>
        <button onClick={() => replaceView(0, 'acmelist')}>
          <span>Up Next</span>
        </button>
        <button>
          <span>Done</span>
        </button>
        <button>
          <span>Inbox</span>
        </button>
        <button>
          <span>Read</span>
        </button>
    </nav>
  );
}
