import type { ReactNode } from 'react';
import { LanguageSwitch, Wordmark } from '../../components/Brand';

/**
 * The frame every signed-out page shares (sign-in, /setup, /signup, /recover, the under-review screen): the language
 * switch, the wordmark, one card. MUT-368 extracted it from the sign-in and setup pages, which each drew it.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="hp-signin">
      <div className="hp-signin-top">
        <LanguageSwitch />
      </div>
      <main className="hp-signin-body">
        <Wordmark />
        {children}
      </main>
    </div>
  );
}
