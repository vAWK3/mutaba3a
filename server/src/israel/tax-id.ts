/**
 * MUT-642: Israeli VAT, company and ID numbers share one form: 9 digits, the last a check digit (alternating weights
 * 1 and 2 from the left, a product above 9 counts its digit sum, the total divisible by 10). Shorter numbers are
 * left-padded with zeros; dashes and spaces are ignored.
 */
export function normalizeTaxId(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{1,9}$/.test(digits)) return null;
  const padded = digits.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const product = Number(padded[i]) * ((i % 2) + 1);
    sum += product > 9 ? product - 9 : product;
  }
  return sum % 10 === 0 ? padded : null;
}

/** Which public registry may know the number: companies start 51/52 (and 54 for partnerships aside), nonprofits 58. */
export function registryOf(taxId: string): 'company' | 'nonprofit' | null {
  if (/^5[12]/.test(taxId)) return 'company';
  if (taxId.startsWith('58')) return 'nonprofit';
  return null;
}
