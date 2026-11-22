import { useDirection } from '../../../lib/i18n/core';
import { useTheme } from '../../../lib/theme';
import issueLight from './art/invoicing-intro-issue-light.svg';
import issueLightRtl from './art/invoicing-intro-issue-light-rtl.svg';
import issueDark from './art/invoicing-intro-issue-dark.svg';
import issueDarkRtl from './art/invoicing-intro-issue-dark-rtl.svg';
import finalLight from './art/invoicing-intro-final-light.svg';
import finalLightRtl from './art/invoicing-intro-final-light-rtl.svg';
import finalDark from './art/invoicing-intro-final-dark.svg';
import finalDarkRtl from './art/invoicing-intro-final-dark-rtl.svg';
import allocationLight from './art/invoicing-intro-allocation-light.svg';
import allocationLightRtl from './art/invoicing-intro-allocation-light-rtl.svg';
import allocationDark from './art/invoicing-intro-allocation-dark.svg';
import allocationDarkRtl from './art/invoicing-intro-allocation-dark-rtl.svg';
import readyLight from './art/invoicing-letterhead-ready-light.svg';
import readyLightRtl from './art/invoicing-letterhead-ready-light-rtl.svg';
import readyDark from './art/invoicing-letterhead-ready-dark.svg';
import readyDarkRtl from './art/invoicing-letterhead-ready-dark-rtl.svg';

/**
 * MUT-646: Claude Design's invoicing art (batch 1). Unlike the token-painted scenes, these drawings keep the printed
 * page's own white paper and ink, so each comes as four files: light and dark, left to right and right to left. The
 * "letterhead ready" files carry their motion inside them (scripts/animate-letterhead-ready.mjs), played once by the
 * browser and left out under prefers-reduced-motion. Decorative: the copy beside them carries the meaning.
 */
type Variants = { light: string; lightRtl: string; dark: string; darkRtl: string };

const INTRO: Record<'issue' | 'final' | 'allocation', Variants> = {
  issue: { light: issueLight, lightRtl: issueLightRtl, dark: issueDark, darkRtl: issueDarkRtl },
  final: { light: finalLight, lightRtl: finalLightRtl, dark: finalDark, darkRtl: finalDarkRtl },
  allocation: { light: allocationLight, lightRtl: allocationLightRtl, dark: allocationDark, darkRtl: allocationDarkRtl },
};
const READY: Variants = { light: readyLight, lightRtl: readyLightRtl, dark: readyDark, darkRtl: readyDarkRtl };

function useVariant(variants: Variants): string {
  const { resolvedTheme } = useTheme();
  const rtl = useDirection() === 'rtl';
  if (resolvedTheme === 'dark') return rtl ? variants.darkRtl : variants.dark;
  return rtl ? variants.lightRtl : variants.light;
}

export function IntroArt({ name }: { name: keyof typeof INTRO }) {
  return <img className="hp-setup-card-art" src={useVariant(INTRO[name])} alt="" width={120} height={96} decoding="async" />;
}

/** Shown once issuing opens: the letterhead's regions tick off and the sheet settles (≤ 1.2 s). */
export function ReadyArt() {
  return <img className="hp-setup-ready-art" src={useVariant(READY)} alt="" width={120} height={140} decoding="async" />;
}
