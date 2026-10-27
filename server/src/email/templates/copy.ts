import type { UserLocale } from '../../repositories/ports.js';
import type { CalendarDay, MailTemplateId, TemplateVars } from '../ports.js';
import type { CustomerMailBody, MailBody } from './layout.js';
import type { CustomerTemplateId } from './look.js';

/**
 * MUT-359: every mail's words, English and Arabic side by side (brief §8.4). Server-generated strings, so a record
 * per language is enough (precedent: PERSONAL_PROFILE_NAME); there is no i18n library on the server. Arabic is the
 * default wherever a caller has no language (ADR-077). No amount, currency or date ever appears (ADR-159 §5), except
 * the deletion day of `account-closing` (MUT-333, ADR-188), never a money date.
 *
 * MUT-468 (plan §4): each customer mail also has a headline and an inbox preview line, in the approved mail kit's
 * shape, with the kit's sample facts corrected. Subjects are unchanged.
 */
type Copy<T extends MailTemplateId> = Record<UserLocale, (vars: TemplateVars[T]) => T extends CustomerTemplateId ? CustomerMailBody : MailBody>;

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

/** "1 day", "3 days". */
function enDays(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** Arabic counted noun: يوم واحد / يومين / 3–10 أيام / 11+ يومًا. */
function arDays(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

const IGNORE: Record<UserLocale, string> = {
  en: "If you didn't ask for this, you can ignore this email. Nothing changes until the link is used.",
  ar: 'إذا لم تطلب ذلك، يمكنك تجاهل هذه الرسالة. لن يتغير شيء ما لم يُستخدم الرابط.',
};

const finishSignup: Copy<'finish-signup'> = {
  en: ({ link, validHours }) => ({
    subject: 'Finish creating your MTB3A account',
    preheader: 'Set a password and your account is ready.',
    headline: 'One step left: set your password',
    intro: [
      ['Someone, hopefully you, asked to create an MTB3A account with this email address.'],
      [`Set your password to finish. The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Set your password', href: link },
    outro: [["Didn't sign up? You can ignore this email. Nothing happens until the link is used."]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'أكمل إنشاء حسابك في متابعة',
    preheader: 'عيّن كلمة المرور ويصبح حسابك جاهزًا.',
    headline: 'خطوة أخيرة: عيّن كلمة المرور',
    intro: [
      ['طلب أحدهم، ونأمل أن تكون أنت، إنشاء حساب في متابعة بعنوان البريد هذا.'],
      [`عيّن كلمة المرور لإكمال الحساب. يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ${arHours(validHours)}.`],
    ],
    action: { label: 'تعيين كلمة المرور', href: link },
    outro: [['لم تطلب إنشاء حساب؟ يمكنك تجاهل هذه الرسالة. لن يحدث شيء ما لم يُستخدم الرابط.']],
  }),
};

const accountExists: Copy<'account-exists'> = {
  en: ({ signInLink, recoverLink }) => ({
    subject: 'You already have an MTB3A account',
    preheader: 'Sign in instead of signing up.',
    headline: 'You already have an account',
    intro: [["Someone asked to create an MTB3A account with this email address, but you already have one. If it was you, sign in, or set a new password if you've forgotten it."]],
    action: { label: 'Sign in', href: signInLink },
    secondary: { label: 'Forgot your password?', href: recoverLink },
    outro: [["If this wasn't you, you can ignore this email. Nothing has changed."]],
  }),
  ar: ({ signInLink, recoverLink }) => ({
    subject: 'لديك حساب في متابعة بالفعل',
    preheader: 'سجّل الدخول بدلًا من إنشاء حساب جديد.',
    headline: 'لديك حساب بالفعل',
    intro: [['طلب أحدهم إنشاء حساب في متابعة بعنوان البريد هذا، لكن لديك حساب بالفعل. إن كنت أنت، سجّل الدخول، أو عيّن كلمة مرور جديدة إذا نسيتها.']],
    action: { label: 'تسجيل الدخول', href: signInLink },
    secondary: { label: 'نسيت كلمة المرور؟', href: recoverLink },
    outro: [['إذا لم تكن أنت، يمكنك تجاهل هذه الرسالة. لم يتغير شيء.']],
  }),
};

const resetPassword: Copy<'reset-password'> = {
  en: ({ link, validHours }) => ({
    subject: 'Set a new MTB3A password',
    preheader: `The link works once, for ${enHours(validHours)}.`,
    headline: 'Set a new password',
    intro: [
      ['Someone asked to set a new password for the MTB3A account with this email address. Your current password keeps working until the new one is set.'],
      [`The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Set a new password', href: link },
    outro: [["Didn't ask for this? Ignore this email and your password stays the same."]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'عيّن كلمة مرور جديدة لحسابك في متابعة',
    preheader: `يعمل الرابط مرة واحدة، لمدة ${arHours(validHours)}.`,
    headline: 'عيّن كلمة مرور جديدة',
    intro: [
      ['طلب أحدهم تعيين كلمة مرور جديدة لحساب متابعة المرتبط بعنوان البريد هذا. تبقى كلمة مرورك الحالية صالحة حتى تُعيَّن الجديدة.'],
      [`يعمل الرابط مرة واحدة وتنتهي صلاحيته بعد ${arHours(validHours)}.`],
    ],
    action: { label: 'تعيين كلمة مرور جديدة', href: link },
    outro: [['لم تطلب ذلك؟ تجاهل هذه الرسالة وستبقى كلمة مرورك كما هي.']],
  }),
};

const finishSetup: Copy<'finish-setup'> = {
  en: ({ link, validHours }) => ({
    subject: 'Finish setting up your MTB3A account',
    preheader: 'Set a password to start.',
    headline: 'Your account is almost ready',
    intro: [
      ['Your MTB3A account is waiting for you to set a password.'],
      [`The link works once and expires in ${enHours(validHours)}.`],
    ],
    action: { label: 'Set your password', href: link },
    outro: [[IGNORE.en]],
  }),
  ar: ({ link, validHours }) => ({
    subject: 'أكمل إعداد حسابك في متابعة',
    preheader: 'عيّن كلمة المرور لتبدأ.',
    headline: 'حسابك شبه جاهز',
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
    preheader: "If this was you, there's nothing to do.",
    headline: first ? 'Your password is set' : 'Your password was changed',
    intro: [
      [first ? 'The password for your MTB3A account was just set. You can sign in with it now.' : 'The password for your MTB3A account was just changed, and your other devices were signed out.'],
      ['If this was you, there is nothing else to do.'],
    ],
    action: { label: 'Sign in', href: signInLink },
    outro: [["If this wasn't you, set a new password from the sign-in page right away, then reply to this email so we can help."]],
  }),
  ar: ({ first, signInLink }) => ({
    subject: first ? 'تم تعيين كلمة مرور حسابك في متابعة' : 'تم تغيير كلمة مرور حسابك في متابعة',
    preheader: 'إن كنت أنت، فلا حاجة لأي إجراء.',
    headline: first ? 'تم تعيين كلمة المرور' : 'تم تغيير كلمة المرور',
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
    preheader: "We'll email you within two working days.",
    headline: "We're reviewing your account",
    intro: [
      ['Thanks for creating an MTB3A account. We review new accounts that use a personal email address before they open.'],
      ["We'll email you within two working days. There's nothing you need to do in the meantime."],
    ],
  }),
  ar: () => ({
    subject: 'نراجع حسابك في متابعة',
    preheader: 'سنراسلك خلال يومَي عمل.',
    headline: 'نراجع حسابك',
    intro: [
      ['شكرًا لإنشاء حساب في متابعة. نراجع الحسابات الجديدة التي تستخدم بريدًا إلكترونيًا شخصيًا قبل تفعيلها.'],
      ['سنراسلك خلال يومَي عمل، ولا يلزمك فعل أي شيء حتى ذلك الحين.'],
    ],
  }),
};

const accountReady: Copy<'account-ready'> = {
  en: ({ signInLink }) => ({
    subject: 'Your MTB3A account is ready',
    preheader: 'We approved your account.',
    headline: 'Your account is ready',
    intro: [['Good news: we approved your account. Sign in to start.']],
    action: { label: 'Sign in', href: signInLink },
  }),
  ar: ({ signInLink }) => ({
    subject: 'حسابك في متابعة جاهز',
    preheader: 'وافقنا على حسابك.',
    headline: 'حسابك جاهز',
    intro: [['خبر سار: وافقنا على حسابك. سجّل الدخول لتبدأ.']],
    action: { label: 'تسجيل الدخول', href: signInLink },
  }),
};

const accountDeclined: Copy<'account-declined'> = {
  en: ({ supportAddress }) => ({
    subject: 'About your MTB3A account request',
    preheader: 'About your account request.',
    headline: "We couldn't approve your account",
    intro: [
      ["We couldn't approve your account request, so we removed it. No data was kept."],
      ['If you think this is a mistake, write to us at ', { mailto: supportAddress }, '.'],
    ],
  }),
  ar: ({ supportAddress }) => ({
    subject: 'بخصوص طلب حسابك في متابعة',
    preheader: 'بخصوص طلب حسابك.',
    headline: 'لم نتمكن من الموافقة على حسابك',
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

/**
 * MUT-419: the trial reminders (ADR-160 D3: 14 days free, read-only to day 30, then locked). Only to people whose
 * standing the trial alone decides, so "your account" is exactly what the gate does. The portal's words: "free trial",
 * "read-only", "Subscribe", "Download my records" (hosted.billing.gate.*). No amount, price or date (ADR-159 §5); the
 * count of days is a count, always "within" so it never promises more time than there is (D2).
 */
const NOTHING_DELETED: Record<UserLocale, string> = {
  en: 'Nothing is deleted.',
  ar: 'لا يُحذف أي شيء.',
};

const trialEndingSoon: Copy<'trial-ending-soon'> = {
  en: ({ daysLeft, subscribeLink }) => ({
    subject: `Your MTB3A free trial ends within ${enDays(daysLeft)}`,
    preheader: 'Add a card so nothing stops.',
    headline: `Your free trial ends within ${enDays(daysLeft)}`,
    intro: [
      [`Your MTB3A free trial ends within ${enDays(daysLeft)}.`],
      ["After that your account becomes read-only: you can still see and download everything, but you can't add or change anything until you subscribe."],
      ['Add a card now so nothing stops.'],
    ],
    action: { label: 'Add a card', href: subscribeLink },
    outro: [['Your records stay safe whatever you decide.']],
  }),
  ar: ({ daysLeft, subscribeLink }) => ({
    subject: `تنتهي تجربتك المجانية في متابعة خلال ${arDays(daysLeft)}`,
    preheader: 'أضف بطاقة كي لا يتوقف شيء.',
    headline: `تنتهي تجربتك المجانية خلال ${arDays(daysLeft)}`,
    intro: [
      [`تنتهي تجربتك المجانية في متابعة خلال ${arDays(daysLeft)}.`],
      ['بعدها يصبح حسابك للقراءة فقط: يمكنك رؤية كل شيء وتنزيله، لكن لا يمكنك إضافة أي شيء أو تعديله إلى أن تشترك.'],
      ['أضف بطاقة الآن كي لا يتوقف شيء.'],
    ],
    action: { label: 'أضف بطاقة', href: subscribeLink },
    outro: [['سجلاتك في أمان مهما قررت.']],
  }),
};

const trialEnded: Copy<'trial-ended'> = {
  en: ({ subscribeLink, exportLink }) => ({
    subject: 'Your MTB3A account is read-only',
    preheader: 'You can still see and download everything.',
    headline: 'Your account is read-only',
    intro: [
      ['Your free trial has ended, so your MTB3A account is now read-only.'],
      ['Your records are safe: you can see and download all of them. Subscribe to keep adding them.'],
    ],
    action: { label: 'Subscribe', href: subscribeLink },
    secondary: { label: 'Download my records', href: exportLink },
    outro: [[NOTHING_DELETED.en]],
  }),
  ar: ({ subscribeLink, exportLink }) => ({
    subject: 'حسابك في متابعة للقراءة فقط',
    preheader: 'ما زال بإمكانك رؤية كل شيء وتنزيله.',
    headline: 'حسابك للقراءة فقط',
    intro: [
      ['انتهت تجربتك المجانية، لذلك أصبح حسابك في متابعة للقراءة فقط.'],
      ['سجلاتك محفوظة: يمكنك رؤيتها كلها وتنزيلها. اشترك لتواصل إضافتها.'],
    ],
    action: { label: 'اشترك', href: subscribeLink },
    secondary: { label: 'نزّل سجلاتي', href: exportLink },
    outro: [[NOTHING_DELETED.ar]],
  }),
};

const trialLockingSoon: Copy<'trial-locking-soon'> = {
  en: ({ daysLeft, subscribeLink, exportLink }) => ({
    subject: `Your MTB3A account locks within ${enDays(daysLeft)}`,
    preheader: 'Nothing is deleted when it locks.',
    headline: `Your account locks within ${enDays(daysLeft)}`,
    intro: [
      [`Your MTB3A account locks within ${enDays(daysLeft)}. After that you can only subscribe or download your records.`],
      ['You can still download all your records, now or after the lock.'],
    ],
    action: { label: 'Subscribe', href: subscribeLink },
    secondary: { label: 'Download my records', href: exportLink },
    outro: [[NOTHING_DELETED.en]],
  }),
  ar: ({ daysLeft, subscribeLink, exportLink }) => ({
    subject: `يُقفَل حسابك في متابعة خلال ${arDays(daysLeft)}`,
    preheader: 'لا يُحذف أي شيء عند الإقفال.',
    headline: `يُقفَل حسابك خلال ${arDays(daysLeft)}`,
    intro: [
      [`يُقفَل حسابك في متابعة خلال ${arDays(daysLeft)}. بعدها لا يمكنك إلا الاشتراك أو تنزيل سجلاتك.`],
      ['ما زال بإمكانك تنزيل كل سجلاتك، الآن أو بعد الإقفال.'],
    ],
    action: { label: 'اشترك', href: subscribeLink },
    secondary: { label: 'نزّل سجلاتي', href: exportLink },
    outro: [[NOTHING_DELETED.ar]],
  }),
};

/**
 * MUT-333: the deletion day in the mail's language, as the portal writes dates (format/dates.ts getLocale): a long
 * calendar date, read in UTC so no zone moves it to another day.
 */
export function mailDay(day: CalendarDay, locale: UserLocale): string {
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar' : 'en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

const accountClosing: Copy<'account-closing'> = {
  en: ({ deleteOn, signInLink }) => ({
    subject: `Your MTB3A account will be deleted on ${mailDay(deleteOn, 'en')}`,
    preheader: 'You can still sign in and keep it.',
    headline: `Your account will be deleted on ${mailDay(deleteOn, 'en')}`,
    intro: [
      [`You closed your MTB3A account. We'll delete it, with all its records and receipts, on ${mailDay(deleteOn, 'en')}.`],
      ["Until then you can sign in and keep it. After that it can't be recovered, and the copies in our backups expire two weeks later."],
    ],
    details: [{ label: 'Deletion day', value: mailDay(deleteOn, 'en') }],
    action: { label: 'Sign in to keep my account', href: signInLink },
    outro: [["If you didn't close it, sign in, keep your account and change your password."]],
  }),
  ar: ({ deleteOn, signInLink }) => ({
    subject: `سيُحذف حسابك في متابعة بتاريخ ${mailDay(deleteOn, 'ar')}`,
    preheader: 'ما زال بإمكانك تسجيل الدخول والإبقاء عليه.',
    headline: `سيُحذف حسابك بتاريخ ${mailDay(deleteOn, 'ar')}`,
    intro: [
      [`أغلقتَ حسابك في متابعة. سنحذفه مع كل سجلاته وإيصالاته بتاريخ ${mailDay(deleteOn, 'ar')}.`],
      ['حتى ذلك الحين يمكنك تسجيل الدخول والإبقاء عليه. بعدها لا يمكن استعادته، وتنتهي النسخ الموجودة في نسخنا الاحتياطية بعد أسبوعين.'],
    ],
    details: [{ label: 'يوم الحذف', value: mailDay(deleteOn, 'ar') }],
    action: { label: 'سجّل الدخول للإبقاء على حسابي', href: signInLink },
    outro: [['إذا لم تكن أنت من أغلقه، سجّل الدخول وأبقِ على حسابك ثم غيّر كلمة المرور.']],
  }),
};

const passkeyAdded: Copy<'passkey-added'> = {
  en: ({ passkeyName, signInLink }) => ({
    subject: 'A passkey was added to your MTB3A account',
    preheader: 'It can sign in without your password.',
    headline: 'A passkey was added',
    intro: [
      ['A passkey was just added to your MTB3A account. It can sign in without your password.'],
      ['If this was you, there is nothing else to do.'],
    ],
    details: [{ label: 'Passkey', value: passkeyName }],
    action: { label: 'Sign in', href: signInLink },
    outro: [["Not you? Sign in, change your password, then remove this passkey from Passkeys in your account. Reply to this email if you need help."]],
  }),
  ar: ({ passkeyName, signInLink }) => ({
    subject: 'أُضيف مفتاح مرور إلى حسابك في متابعة',
    preheader: 'يمكنه تسجيل الدخول دون كلمة المرور.',
    headline: 'أُضيف مفتاح مرور',
    intro: [
      ['أُضيف للتو مفتاح مرور إلى حسابك في متابعة. يمكنه تسجيل الدخول دون كلمة المرور.'],
      ['إذا كنت أنت من قام بذلك، فلا حاجة لأي إجراء آخر.'],
    ],
    details: [{ label: 'مفتاح المرور', value: passkeyName }],
    action: { label: 'تسجيل الدخول', href: signInLink },
    outro: [['لم تكن أنت؟ سجّل الدخول وغيّر كلمة المرور، ثم احذف مفتاح المرور هذا من «مفاتيح المرور» في حسابك. ردّ على هذه الرسالة إن احتجت إلى مساعدة.']],
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
  'trial-ending-soon': trialEndingSoon,
  'trial-ended': trialEnded,
  'trial-locking-soon': trialLockingSoon,
  'account-closing': accountClosing,
  'passkey-added': passkeyAdded,
};
