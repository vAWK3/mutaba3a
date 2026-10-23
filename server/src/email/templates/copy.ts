import type { UserLocale } from '../../repositories/ports.js';
import type { MailTemplateId, TemplateVars } from '../ports.js';
import type { MailBody } from './layout.js';

/**
 * MUT-359: every mail's words, English and Arabic side by side (brief §8.4). Server-generated strings, so a record
 * per language is enough (precedent: PERSONAL_PROFILE_NAME); there is no i18n library on the server. Arabic is the
 * default wherever a caller has no language (ADR-077). No amount, currency or date ever appears (ADR-159 §5).
 */
type Copy<T extends MailTemplateId> = Record<UserLocale, (vars: TemplateVars[T]) => MailBody>;

/** "1 hour", "24 hours". */
function enHours(n: number): string {
  return n === 1 ? '1 hour' : `${n} hours`;
}

/** Arabic counted noun: واحدة / مثنى / 3–10 جمع / 11+ مفرد منصوب. */
function arHours(n: number): string {
  if (n === 1) return 'ساعة واحدة';
  if (n === 2) return 'ساعتين';
  if (n >= 3 && n <= 10) return `${n} ساعات`;
  return `${n} ساعة`;
}

const IGNORE: Record<UserLocale, string> = {
  en: "If you didn't ask for this, you can ignore this email. Nothing changes until the link is used.",
  ar: 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة. لن يتغير شيء ما لم يُستخدم الرابط.',
};

const finishSignup: Copy<'finish-signup'> = {
  en: ({ link, validHours }) => ({
    subject: 'Finish creating your MTB3A account',
    intro: [
      ['Someone, hopefully you, asked to create an MTB3A account with this email address.'],
      [`Set your password to finish. The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Finish creating your account', href: link },
    outro: [[IGNORE.en]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'أكمل إنشاء حسابك في متابعة',
    intro: [
      ['طلب أحدهم، ونأمل أن تكون أنت، إنشاء حساب في متابعة بعنوان البريد هذا.'],
      [`عيّن كلمة المرور لإكمال الحساب. يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ${arHours(validHours)}.`],
    ],
    action: { label: 'أكمل إنشاء الحساب', href: link },
    outro: [[IGNORE.ar]],
  }),
};

const accountExists: Copy<'account-exists'> = {
  en: ({ signInLink, recoverLink }) => ({
    subject: 'You already have an MTB3A account',
    intro: [['Someone asked to create an MTB3A account with this email address, but you already have one. Sign in, or set a new password if you\'ve forgotten it.']],
    action: { label: 'Sign in', href: signInLink },
    secondary: { label: 'Forgot your password?', href: recoverLink },
    outro: [["If this wasn't you, you can ignore this email. Nothing has changed."]],
  }),
  ar: ({ signInLink, recoverLink }) => ({
    subject: 'لديك حساب في متابعة بالفعل',
    intro: [['طلب أحدهم إنشاء حساب في متابعة بعنوان البريد هذا، لكن لديك حساب بالفعل. سجّل الدخول، أو عيّن كلمة مرور جديدة إذا نسيتها.']],
    action: { label: 'تسجيل الدخول', href: signInLink },
    secondary: { label: 'نسيت كلمة المرور؟', href: recoverLink },
    outro: [['إذا لم تكن أنت، يمكنك تجاهل هذه الرسالة. لم يتغير شيء.']],
  }),
};

const resetPassword: Copy<'reset-password'> = {
  en: ({ link, validHours }) => ({
    subject: 'Set a new MTB3A password',
    intro: [
      ['Someone asked to set a new password for the MTB3A account with this email address. Your current password keeps working until the new one is set.'],
      [`The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Set a new password', href: link },
    outro: [[IGNORE.en]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'عيّن كلمة مرور جديدة لحسابك في متابعة',
    intro: [
      ['طلب أحدهم تعيين كلمة مرور جديدة لحساب متابعة المرتبط بعنوان البريد هذا. تبقى كلمة مرورك الحالية صالحة حتى تُعيَّن الجديدة.'],
      [`يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ${arHours(validHours)}.`],
    ],
    action: { label: 'تعيين كلمة مرور جديدة', href: link },
    outro: [[IGNORE.ar]],
  }),
};

const finishSetup: Copy<'finish-setup'> = {
  en: ({ link, validHours }) => ({
    subject: 'Finish setting up your MTB3A account',
    intro: [
      ['Your MTB3A account is waiting for you to set a password.'],
      [`The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Set your password', href: link },
    outro: [[IGNORE.en]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'أكمل إعداد حسابك في متابعة',
    intro: [
      ['حسابك في متابعة بانتظار أن تعيّن كلمة المرور.'],
      [`يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ${arHours(validHours)}.`],
    ],
    action: { label: 'تعيين كلمة المرور', href: link },
    outro: [[IGNORE.ar]],
  }),
};

const passwordChanged: Copy<'password-changed'> = {
  en: ({ first, signInLink }) => ({
    subject: first ? 'Your MTB3A password is set' : 'Your MTB3A password was changed',
    intro: [
      [first ? 'The password for your MTB3A account was just set. You can sign in with it now.' : 'The password for your MTB3A account was just changed, and your other devices were signed out.'],
      ['If this was you, there is nothing else to do.'],
    ],
    action: { label: 'Sign in', href: signInLink },
    outro: [["If this wasn't you, set a new password from the sign-in page right away, then reply to this email so we can help."]],
  }),
  ar: ({ first, signInLink }) => ({
    subject: first ? 'تم تعيين كلمة مرور حسابك في متابعة' : 'تم تغيير كلمة مرور حسابك في متابعة',
    intro: [
      [first ? 'تم للتو تعيين كلمة مرور حسابك في متابعة. يمكنك تسجيل الدخول بها الآن.' : 'تم للتو تغيير كلمة مرور حسابك في متابعة، وتم تسجيل خروج أجهزتك الأخرى.'],
      ['إذا كنت أنت من قام بذلك، فلا حاجة لأي إجراء آخر.'],
    ],
    action: { label: 'تسجيل الدخول', href: signInLink },
    outro: [['إذا لم تكن أنت، عيّن كلمة مرور جديدة من صفحة تسجيل الدخول فورًا، ثم ردّ على هذه الرسالة لنساعدك.']],
  }),
};

const accountUnderReview: Copy<'account-under-review'> = {
  en: () => ({
    subject: "We're reviewing your MTB3A account",
    intro: [
      ['Thanks for creating an MTB3A account. We review new accounts that use a personal email address before they open.'],
      ["We'll email you within two working days."],
    ],
  }),
  ar: () => ({
    subject: 'نراجع حسابك في متابعة',
    intro: [
      ['شكرًا لإنشاء حساب في متابعة. نراجع الحسابات الجديدة التي تستخدم بريدًا إلكترونيًا شخصيًا قبل تفعيلها.'],
      ['سنراسلك خلال يومَي عمل.'],
    ],
  }),
};

const accountReady: Copy<'account-ready'> = {
  en: ({ signInLink }) => ({
    subject: 'Your MTB3A account is ready',
    intro: [['We approved your account. Sign in to start.']],
    action: { label: 'Sign in', href: signInLink },
  }),
  ar: ({ signInLink }) => ({
    subject: 'حسابك في متابعة جاهز',
    intro: [['وافقنا على حسابك. سجّل الدخول لتبدأ.']],
    action: { label: 'تسجيل الدخول', href: signInLink },
  }),
};

const accountDeclined: Copy<'account-declined'> = {
  en: ({ supportAddress }) => ({
    subject: 'About your MTB3A account request',
    intro: [
      ["We couldn't approve your account request, so we removed it. No data was kept."],
      ['If you think this is a mistake, write to us at ', { mailto: supportAddress }, '.'],
    ],
  }),
  ar: ({ supportAddress }) => ({
    subject: 'بخصوص طلب حسابك في متابعة',
    intro: [
      ['لم نتمكن من الموافقة على طلب حسابك، فأزلناه. لم نحتفظ بأي بيانات.'],
      ['إذا كنت ترى أن هذا خطأ، راسلنا على ', { mailto: supportAddress }, '.'],
    ],
  }),
};

const reviewDigest: Copy<'review-digest'> = {
  en: ({ pending, command }) => ({
    subject: `MTB3A: ${pending} ${pending === 1 ? 'signup is' : 'signups are'} waiting for review`,
    intro: [
      [`Signups waiting for your review: ${pending}.`],
      ['Review them with ', { ltr: command }, '.'],
    ],
  }),
  ar: ({ pending, command }) => ({
    subject: `متابعة: طلبات تسجيل بانتظار المراجعة (${pending})`,
    intro: [
      [`طلبات التسجيل التي تنتظر مراجعتك: ${pending}.`],
      ['راجعها بالأمر ', { ltr: command }, '.'],
    ],
  }),
};

export const COPY: { [T in MailTemplateId]: Copy<T> } = {
  'finish-signup': finishSignup,
  'account-exists': accountExists,
  'reset-password': resetPassword,
  'finish-setup': finishSetup,
  'password-changed': passwordChanged,
  'account-under-review': accountUnderReview,
  'account-ready': accountReady,
  'account-declined': accountDeclined,
  'review-digest': reviewDigest,
};
