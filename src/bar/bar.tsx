import styles from './bar.module.css';
import CloudOffSVG from '../icons/cloud-off.svg';
import SearchSVG from '../icons/search.svg';

export function Bar() {
  return (
    <div class={styles['top-bar']}>
          <CloudOffSVG />
          <SearchSVG />
    </div>
  )
}