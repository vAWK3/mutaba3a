import { useEffect, useState } from 'react';
import markUrl from '../../assets/brand/mark.svg';
import markDarkUrl from '../../assets/brand/mark-dark.svg';
import { BrandLoader } from './BrandLoader';
import { bootDelayMs } from './bootDelay';

/**
 * The boot splash as a React fallback (MUT-207 D3, DR10): the landing,
 * download, privacy and /hosted pages show it while their code loads. Its
 * first render is the static splash in index.html, element for element (the
 * two must stay in step; brand-head.test.ts compares them), so the hand-off
 * from HTML to React changes nothing on screen. After `bootDelayMs()` the
 * mark becomes the bloom loader in place (96, whose frame 0 is the same 80 px
 * mark), with no fade and no slow caption.
 */
export function BootSplash() {
  const [blooming, setBlooming] = useState(() => bootDelayMs() === 0);

  useEffect(() => {
    if (blooming) return;
    const timer = setTimeout(() => setBlooming(true), bootDelayMs());
    return () => clearTimeout(timer);
  }, [blooming]);

  if (blooming) {
    // No aria-hidden once it blooms: the loader's status says what is happening (DR14)
    return (
      <div className="boot-splash">
        <BrandLoader size={96} delay={0} />
      </div>
    );
  }
  return (
    <div className="boot-splash" aria-hidden="true">
      <picture>
        <source srcSet={markDarkUrl} media="(prefers-color-scheme: dark)" />
        <img className="boot-splash-mark" src={markUrl} width={80} height={80} alt="" />
      </picture>
    </div>
  );
}
