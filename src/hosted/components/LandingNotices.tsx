import type { RefObject } from 'react';
import { FirmOnBanner } from './FirmOnBanner';
import { MalafatCreatedNote } from './MalafatPortal';
import { PasskeySuggestion } from './PasskeySuggestion';
import { SecondWayIn } from './SecondWayIn';
import { TrialBanner } from './TrialBanner';
import { UsageNotice } from './UsageNotice';

/**
 * The one-time notices a visit lands on (MUT-657: moved from Owed's overview to home, where every visit now starts),
 * in their order of old: the trial's line, the passkey suggestion, Sign in with Malafat's second way in, the new
 * business profile's note and firm features turning on. `heading` takes focus when the profile note goes.
 */
export function LandingNotices({ heading }: { heading: RefObject<HTMLHeadingElement | null> }) {
  return (
    <>
      {/* MUT-731 (wireframe 7): Starter's fuller meter, from 80% (a quiet line), 90% (a banner) and at the limit */}
      <UsageNotice />
      {/* MUT-418: the free trial's days left, until a card is on file */}
      <TrialBanner />
      {/* MUT-370: suggest a passkey, after the trial's first-run step and under its banner (D4) */}
      <PasskeySuggestion />
      {/* MUT-596: an account Sign in with Malafat made, until it has a way in of its own (in the passkey card's place) */}
      <SecondWayIn />
      {/* Right after a business profile is created, once (MUT-191); dismissed, focus goes to the heading */}
      <MalafatCreatedNote onGone={() => heading.current?.focus()} />
      {/* MUT-300 (DR5): once firm features are on, until dismissed */}
      <FirmOnBanner />
    </>
  );
}
