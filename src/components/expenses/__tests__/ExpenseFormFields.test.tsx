import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExpenseFormFields, type ExpenseFormFieldsLabels } from '../ExpenseFormFields';
import { expenseFormFieldsSchema, type ExpenseFormFieldsValues } from '../expenseFormSchema';

const labels: ExpenseFormFieldsLabels = {
  amount: 'Amount',
  amountPlaceholder: '0.00',
  currency: 'Currency',
  date: 'Date',
  title: 'Title',
  titlePlaceholder: 'What was it for?',
  category: 'Category',
  categoryPlaceholder: 'Choose a category',
  notes: 'Notes',
  notesPlaceholder: 'Optional notes',
  requiredError: 'Required',
  amountError: 'Enter a valid amount',
};

const categories = [
  { id: 'cat-1', name: 'Software' },
  { id: 'cat-2', name: 'Travel' },
];

function Harness({
  amountInputMode = 'number' as const,
  onSubmit = () => {},
  includeProject = true,
}: {
  amountInputMode?: 'number' | 'decimalText';
  onSubmit?: (v: ExpenseFormFieldsValues) => void;
  includeProject?: boolean;
}) {
  const form = useForm<ExpenseFormFieldsValues>({
    resolver: zodResolver(expenseFormFieldsSchema),
    defaultValues: { amount: '', currency: 'USD', occurredAt: '2026-10-11', title: '', categoryId: '', notes: '' },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <ExpenseFormFields
        control={form.control}
        errors={form.formState.errors}
        categories={categories}
        currencyOptions={['USD', 'ILS']}
        amountInputMode={amountInputMode}
        labels={labels}
        vendorField={<input aria-label="vendor-slot" />}
        clientField={<input aria-label="client-slot" />}
        projectField={includeProject ? <input aria-label="project-slot" /> : undefined}
      />
      <button type="submit">Save</button>
    </form>
  );
}

describe('ExpenseFormFields', () => {
  it('renders fields in the approved order: amount/currency, date, title, vendor, client, project, category, notes', () => {
    render(<Harness />);
    const labelTexts = screen
      .getAllByText(/Amount|Date|Title|Category|Notes/i, { selector: 'label' })
      .map((el) => el.textContent?.replace(/\s*\*?\s*$/, ''));
    expect(labelTexts).toEqual(['Amount', 'Date', 'Title', 'Category', 'Notes']);

    // Slots sit between Title and Category in document order.
    const title = screen.getByLabelText(/^Title\s*$/);
    const vendorSlot = screen.getByLabelText('vendor-slot');
    const clientSlot = screen.getByLabelText('client-slot');
    const projectSlot = screen.getByLabelText('project-slot');
    const category = screen.getByLabelText(/^Category \*$/);
    const positions = [title, vendorSlot, clientSlot, projectSlot, category].map(
      (el) => Array.from(document.querySelectorAll('*')).indexOf(el),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('renders the given currency options only', () => {
    render(<Harness />);
    const select = screen.getByLabelText(/^Currency \*$/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['USD', 'ILS']);
  });

  it('uses a number input for amountInputMode="number" (local, unchanged)', () => {
    render(<Harness amountInputMode="number" />);
    const amount = screen.getByLabelText(/^Amount \*$/) as HTMLInputElement;
    expect(amount.type).toBe('number');
  });

  it('uses a dir="ltr" text input for amountInputMode="decimalText" (hosted)', () => {
    render(<Harness amountInputMode="decimalText" />);
    const amount = screen.getByLabelText(/^Amount \*$/) as HTMLInputElement;
    expect(amount.type).toBe('text');
    expect(amount.getAttribute('dir')).toBe('ltr');
    expect(amount.getAttribute('inputmode')).toBe('decimal');
  });

  it('shows a required-field error on submit with an empty category', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText(/^Amount \*$/), '12.50');
    await user.click(screen.getByText('Save'));
    expect(await screen.findByText('Required')).toBeInTheDocument();
  });

  it('omits the project slot entirely when not provided (local, Projects area off)', () => {
    render(<Harness includeProject={false} />);
    expect(screen.queryByLabelText('project-slot')).not.toBeInTheDocument();
  });
});
