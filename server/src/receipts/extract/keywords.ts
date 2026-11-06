import { foldForMatch } from './normalize.js';

/**
 * MUT-441: the labels receipts print, in Hebrew, Arabic and English. Matched on folded text (`foldForMatch`), as whole
 * words: a keyword never matches inside a longer word (`total` not in `subtotal`, `ע"מ` not in `בע"מ`).
 */
export type KeywordSet = readonly RegExp[];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywords(...words: string[]): KeywordSet {
  return words.map((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(foldForMatch(w))}(?![\\p{L}])`, 'u'));
}

export function hasKeyword(folded: string, set: KeywordSet): boolean {
  return set.some((pattern) => pattern.test(folded));
}

export const TOTAL = keywords(
  'סה"כ', 'סהכ', 'סך הכל', 'סך הכול', 'לתשלום', 'המחיר', 'סכום לתשלום', 'סה"כ לחיוב',
  'المجموع', 'الإجمالي', 'اجمالي', 'المبلغ الإجمالي', 'المبلغ المستحق', 'المطلوب', 'المجموع الكلي',
  'total', 'amount due', 'grand total', 'balance due', 'total due', 'to pay',
);

/** The amount before VAT. */
export const SUBTOTAL = keywords(
  'סכום ביניים', 'לפני מע"מ', 'ללא מע"מ', 'המחיר לפני מע"מ',
  // MUT-504: an Israeli bill's "total of the amounts at 18% VAT", before the VAT is added.
  'סה"כ סכומים', 'סכומים ב', 'חייב במע"מ', 'חייב מע"מ',
  'المجموع الفرعي', 'قبل الضريبة', 'غير شامل',
  'subtotal', 'sub total', 'sub-total', 'before vat', 'before tax', 'excl', 'excluding',
  // MUT-514: the pre-VAT amount, as English and Arabic tax invoices label it.
  'total to vat', 'amount before vat', 'net amount', 'المبلغ قبل الضريبة',
);

/**
 * MUT-504: the card slip's amount on an Israeli till receipt. It is what was paid, but a split payment prints two, so
 * it counts as the total only when the receipt agrees, or when nothing on it says the payment was split (MUT-540,
 * `total.ts`).
 */
export const CARD_SLIP = keywords('סכום עסקה', 'סכום חיוב', /* MUT-540: as Paz and pharmacy slips spell it */ 'סכום עיסקה', 'סכום העסקה', 'סכום העיסקה');

/**
 * MUT-540 (D8): another way of paying part of the bill (a voucher or gift card, a credit note, a cheque, Bit or
 * PayBox, points, another card): beside it, a card slip may be only the rest. Counts only on a row with an amount
 * other than the slip's (a slip's own "מס' שובר" and "אשראי: רגיל" carry none; "אשראי 120.40" beside a 120.40 slip
 * is the same payment).
 */
export const OTHER_TENDER = keywords(
  'תו קנייה', 'תו קניה', 'תווי קנייה', 'תווי קניה', 'שובר מתנה', 'שובר זיכוי', 'כרטיס מתנה', 'גיפט קארד', 'buyme',
  "צ'ק", 'צק', 'שיק', 'המחאה', 'ביט', 'פייבוקס', 'bit', 'paybox', 'נקודות', 'אשראי',
  'gift card', 'voucher', 'cheque', 'points', 'credit',
  'قسيمة', 'بطاقة هدية', 'شيك', 'آجل', 'نقاط',
);

/** MUT-540 (review): a deposit or advance: its card slip pays part of a bill, never the whole of it. */
export const DEPOSIT = keywords('מקדמה', 'מקדמות', 'דמי רצינות', 'deposit', 'advance payment', 'down payment', 'عربون', 'دفعة مقدمة', 'دفعة أولى');

/** MUT-540 (review): a refund or a cancelled sale: its card slip is money back, never an expense's total. */
export const REFUND = keywords('זיכוי', 'עסקת זיכוי', 'ביטול', 'ביטול עסקה', 'החזר', 'החזר כספי', 'refund', 'void', 'استرجاع', 'مرتجع', 'إرجاع', 'إلغاء');

/**
 * MUT-540 (review): a quantity's unit: litres, kilograms, a price per one. A row naming one carries a quantity or a
 * unit price, never the total, even on a "סה"כ ליטרים" or "המחיר לליטר" row.
 */
export const UNIT = keywords('ליטר', 'ליטרים', 'לליטר', 'ק"ג', 'לק"ג', "ליח'", 'ליחידה', 'litre', 'litres', 'liter', 'liters', 'per litre', 'per liter', 'kg', 'لتر', 'لترات', 'كغ');

/** MUT-504: a discount line. Its amount is never the total, and a discount makes the largest amount a pre-discount one. */
export const DISCOUNT = keywords('הנחה', 'הנחות', 'חסכת', 'חיסכון', 'خصم', 'تخفيض', 'discount', 'savings', 'you saved');

/** Lines that name a part of the total or a count, never the total itself. */
export const NOT_TOTAL = [...SUBTOTAL, ...DISCOUNT, ...keywords('פריטים', 'כמות', 'عدد الأصناف', 'الكمية', 'total items', 'items', 'qty', 'quantity')];

/** A VAT line that is really the total including VAT. */
export const INCLUSIVE = keywords('כולל', 'כולל מע"מ', 'شامل', 'شامل الضريبة', 'incl', 'including', 'inc. vat', 'inc. tax');

export const VAT = keywords('מע"מ', 'מעמ', 'ضريبة القيمة المضافة', 'الضريبة', 'ضريبة', 'ض.ق.م', 'vat', 'tax');

/** Cash handed over: more than the total when change is given. */
export const TENDERED = keywords('מזומן', 'نقدا', 'نقدي', 'cash', 'tendered');
/** What was paid. On a total-labelled row ("סה"כ שולם", "total paid") it is the total, not cash tendered (MUT-514). */
export const PAID = keywords('שולם', 'المدفوع', 'مدفوع', 'paid');
export const CASH = [...TENDERED, ...PAID];

export const CHANGE = keywords('עודף', 'الباقي', 'المتبقي', 'الفكة', 'باقي', 'change');

/** MUT-514: a tip or service charge, a part added on top: never the total. */
export const TIP = keywords('תשר', 'טיפ', 'service charge', 'tip', 'gratuity', 'بقشيش', 'خدمة');
/** A total that says the tip is not in it ("Total before tip", "tip not included"). */
export const TIP_APART = keywords('before tip', 'excluding tip', 'not included', 'לפני תשר', 'ללא תשר', 'לא כולל');

/**
 * MUT-514 (OV-7): one instalment of a card payment, never the total: a labelled part, or a count above one
 * (`תשלומים: 3`, `2 מתוך 3`). A single payment (`מס' תשלומים: 1`) is an ordinary card slip.
 */
const INSTALLMENT_PART = keywords('תשלום ראשון', 'תשלום נוסף', 'installment', 'قسط');
const INSTALLMENT_COUNT = /(?:תשלומים|installments|اقساط)\s*:?\s*(\d{1,2})(?!\d)|(?<!\d)\d{1,2}\s*מתוך\s*(\d{1,2})(?!\d)/u;
/** "עמוד 1 מתוך 2": a page count, not a payment's. */
const PAGE_COUNT = /(?:עמוד|דף|page|صفحة)\s*:?\s*\d{1,2}\s*(?:מתוך|of|من)\s*\d{1,2}/u;

export function isInstallment(folded: string): boolean {
  if (hasKeyword(folded, INSTALLMENT_PART)) return true;
  const count = INSTALLMENT_COUNT.exec(folded.replace(PAGE_COUNT, ' '));
  return count !== null && Number(count[1] ?? count[2]) > 1;
}

/** MUT-514 (T1): what is still to pay ("יתרה"): a labelled amount, though not a total label of its own. */
export const BALANCE = keywords('יתרה', 'יתרה לתשלום', 'balance', 'الرصيد');

export const DATE_LABEL = keywords('תאריך', 'التاريخ', 'تاريخ', 'date');

/** MUT-504: a card's or a contract's validity ("valid until 01/06/2029"): its date is never the receipt's. */
export const VALIDITY = keywords('תוקף', 'בתוקף', 'صالح', 'صلاحية', 'انتهاء', 'valid', 'validity', 'expiry', 'expires', 'exp');

/** MUT-504: a due date ("pay by"): an invoice's own date is its issue date, never when it falls due. */
export const DUE = keywords('due', 'due date', 'payment due', 'תאריך פירעון', 'פירעון', 'מועד תשלום', 'לתשלום עד', 'تاريخ الاستحقاق', 'استحقاق');

export const REGISTRATION = keywords(
  'ח.פ', 'ח"פ', 'חפ', 'ע.מ', 'ע"מ', 'עוסק מורשה', 'עוסק פטור', "מס' עוסק", 'מספר עוסק', 'מס עוסק', 'ח.צ', 'ע.ר',
  'مشتغل مرخص', 'المشتغل', 'رقم مشتغل', 'رقم الشركة', 'مشتغل',
  'vat no', 'vat reg', 'reg no', 'reg. no', 'company no', 'business no', 'tax id', 'osek',
  // MUT-514: the English for עוסק מורשה.
  'authorized dealer', 'dealer no',
  // MUT-540: a corporation's (an amuta's, a company's) number, also with its thermal yod after ג read as a geresh,
  // which the fold keeps for loanwords (ג'ינס). Only as a number's label: "תאגיד המים" is a water company's name.
  "מס' תאגיד", 'מספר תאגיד', 'תאגיד מס', "תאג'ד מס",
);

/**
 * MUT-557 (D2): the label of an Israeli tax invoice's allocation number (מספר הקצאה). Its nine digits are read only
 * beside one of these: a bare nine-digit number is as likely a ח.פ or ע.מ.
 */
export const ALLOCATION = keywords(
  'מספר הקצאה', "מס' הקצאה", 'מס הקצאה', 'מס. הקצאה', 'אישור הקצאה', 'מספר אישור הקצאה',
  'allocation no', 'allocation no.', 'allocation number', 'allocation num',
  'رقم التخصيص', 'رقم تخصيص',
);

export const PHONE = keywords('טל', "טל'", 'טלפון', 'נייד', 'פלאפון', 'هاتف', 'تلفون', 'جوال', 'ت', 'tel', 'phone', 'mobile', 'mob');

/** A receipt's title or boilerplate, never its vendor. */
export const NOT_VENDOR = keywords(
  'חשבונית', 'חשבונית מס', 'קבלה', 'מקור', 'העתק', 'נאמן למקור', 'ברוכים', 'תודה',
  'فاتورة', 'ايصال', 'إيصال', 'سند', 'ضريبية', 'اهلا', 'شكرا',
  'receipt', 'invoice', 'tax invoice', 'welcome', 'thank', 'copy', 'original', 'www', 'http',
);

/** A company form in a name: the vendor line is surer when it carries one. */
export const COMPANY = keywords('בע"מ', 'חברת', 'ltd', 'inc', 'llc', 'gmbh', 'co.', 'شركة', 'ش.م', 'ذ.م.م', 'م.خ.م');

/**
 * MUT-514 (D6, D10): a bill-to label. The rows it heads name the customer, whose numbers are never the vendor's.
 * `السيداة` is how OCR prints `السيد/ة`. Not `ת.ז`: an exempt dealer (עוסק פטור) registers under their own ID.
 */
export const CUSTOMER = keywords(
  'לכבוד', 'לקוח', 'שם לקוח', 'עבור',
  'bill to', 'billed to', 'customer', 'sold to', 'to:',
  'السيد', 'السيدة', 'السيد/ة', 'السيداة', 'السادة', 'العميل', 'الزبون', 'رقم الهوية',
);

/**
 * MUT-514 (R9): phrases that hold a CUSTOMER word but head no bill-to block: a copy's title, a customer number, payee
 * details, the vendor's customer service, a walk-in customer.
 */
export const NOT_CUSTOMER = keywords(
  'העתק לקוח', 'customer copy', 'מספר לקוח', "מס' לקוח", 'מס.לקוח', 'pay to', 'payable to',
  'customer service', 'customer care', 'customer support', 'לקוח מזדמן', 'לקוח: מזדמן', 'שירות לקוחות',
);

/** MUT-514 (O1): a street, the start of an address line. */
export const STREET = keywords("רח'", 'רחוב', "שד'", 'شارع', 'street', 'st.', 'road', 'rd.');

/** MUT-514: column headings of an item table; a row with two of them is the table's header. */
export const TABLE_COLUMN = keywords('תיאור', 'פריט', 'כמות', 'מחיר', 'סכום', 'description', 'item', 'qty', 'quantity', 'price', 'amount', 'الوصف', 'الصنف', 'الكمية', 'السعر', 'المبلغ');
