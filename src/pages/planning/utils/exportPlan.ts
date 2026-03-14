import type { Plan, MonthProjection, Currency } from '../../../types';

/**
 * Export plan projections to CSV format
 */
export function exportPlanToCSV(
  plan: Plan,
  monthlyProjections: MonthProjection[],
  locale: 'en' | 'ar'
): void {
  const isArabic = locale === 'ar';

  // Column headers
  const headers = isArabic
    ? ['الشهر', 'الرصيد الافتتاحي', 'التدفقات الداخلة', 'التدفقات الخارجة', 'صافي التدفق', 'الرصيد الختامي', 'نسبة الثقة']
    : ['Month', 'Opening Cash', 'Cash In', 'Cash Out', 'Net Flow', 'Closing Cash', 'Confidence %'];

  // Format amount from minor units
  const formatAmount = (amountMinor: number, currency: Currency): string => {
    const amount = amountMinor / 100;
    return `${amount.toFixed(2)} ${currency}`;
  };

  // Format month label
  const formatMonth = (month: string): string => {
    const [year, m] = month.split('-');
    const date = new Date(Number(year), Number(m) - 1);
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'short' });
  };

  // Build CSV rows
  const rows: string[][] = [headers];

  for (const projection of monthlyProjections) {
    rows.push([
      formatMonth(projection.month),
      formatAmount(projection.openingCashMinor, plan.currency),
      formatAmount(projection.cashInMinor, plan.currency),
      formatAmount(projection.cashOutMinor, plan.currency),
      formatAmount(projection.netFlowMinor, plan.currency),
      formatAmount(projection.closingCashMinor, plan.currency),
      `${Math.round(projection.confidenceScore * 100)}%`,
    ]);
  }

  // Convert to CSV string
  const csvContent = rows
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  // Add BOM for UTF-8 (important for Arabic)
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // Generate filename
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${plan.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}_${timestamp}.csv`;

  // Trigger download
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Export assumptions to CSV format
 */
export function exportAssumptionsToCSV(
  plan: Plan,
  assumptions: Array<{
    category: string;
    type: string;
    label: string;
    amountMinor: number;
    currency: Currency;
    startMonth: string;
    endMonth?: string;
    frequency?: string;
    confidence: string;
    notes?: string;
  }>,
  locale: 'en' | 'ar'
): void {
  const isArabic = locale === 'ar';

  const headers = isArabic
    ? ['الفئة', 'النوع', 'الوصف', 'المبلغ', 'شهر البداية', 'شهر النهاية', 'التكرار', 'الثقة', 'ملاحظات']
    : ['Category', 'Type', 'Label', 'Amount', 'Start Month', 'End Month', 'Frequency', 'Confidence', 'Notes'];

  const formatAmount = (amountMinor: number, currency: Currency): string => {
    const amount = amountMinor / 100;
    return `${amount.toFixed(2)} ${currency}`;
  };

  const rows: string[][] = [headers];

  for (const assumption of assumptions) {
    rows.push([
      assumption.category,
      assumption.type,
      assumption.label,
      formatAmount(assumption.amountMinor, assumption.currency),
      assumption.startMonth,
      assumption.endMonth || '',
      assumption.frequency || '',
      assumption.confidence,
      assumption.notes || '',
    ]);
  }

  const csvContent = rows
    .map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `${plan.name.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}_assumptions_${timestamp}.csv`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}
