import styles from './top-bar.module.css';
import SidebarSVG from '../icons/sidebar.svg';
import SearchSVG from '../icons/search.svg';
import SlidersSVG from '../icons/sliders.svg';
import CloudOffSVG from '../icons/cloud-off.svg';
import ChevronDownSVG from '../icons/chevron-down.svg';

export function TopBar() {
  return (
    <div class={styles['top-bar']}>
        <nav>
            <SidebarSVG />
            <SlidersSVG />
            <CloudOffSVG />
            <SearchSVG />
        </nav>
        <div style='display: flex; align-items: center;'>
          <span>Daniel</span>
          <ChevronDownSVG />
        </div>
    </div>
  )
}