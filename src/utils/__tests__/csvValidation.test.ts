import { describe, it, expect } from 'vitest';
import { validateCSVRow, ValidationStatus } from '../csvValidation';

describe('CSV Validation', () => {
  describe('validateCSVRow', () => {
    describe('Client validation', () => {
      it('should validate correct client row as new', () => {
        const row = {
          type: 'client',
          name: 'New Client',
          email: 'client@example.com',
          phone: '555-1234',
          notes: 'Test client',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
        expect(result.warnings).toHaveLength(0);
      });

      it('should detect duplicate client by name', () => {
        const row = {
          type: 'client',
          name: 'Existing Client',
          email: '',
          phone: '',
        };

        const existingClients = ['Existing Client', 'Other Client'];

        const result = validateCSVRow(row, 0, existingClients);

        expect(result.status).toBe(ValidationStatus.DUPLICATE);
        expect(result.warnings).toContain('Client with this name already exists');
      });

      it('should error if client name is missing', () => {
        const row = {
          type: 'client',
          name: '',
          email: 'test@example.com',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Client name is required');
      });
    });

    describe('Project validation', () => {
      it('should validate correct project row as new', () => {
        const row = {
          type: 'project',
          name: 'New Project',
          client: 'Existing Client',
          field: 'development',
        };

        const result = validateCSVRow(row, 0, [], [], ['Existing Client']);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
      });

      it('should detect duplicate project by name', () => {
        const row = {
          type: 'project',
          name: 'Existing Project',
          client: 'Test Client',
          field: 'design',
        };

        const existingProjects = ['Existing Project'];

        const result = validateCSVRow(row, 0, [], existingProjects);

        expect(result.status).toBe(ValidationStatus.DUPLICATE);
        expect(result.warnings).toContain('Project with this name already exists');
      });

      it('should error if project name is missing', () => {
        const row = {
          type: 'project',
          name: '',
          client: 'Client Name',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Project name is required');
      });

      it('should error if field value is invalid', () => {
        const row = {
          type: 'project',
          name: 'Test Project',
          field: 'invalid-field',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Invalid field value. Must be one of: design, development, consulting, marketing, legal, maintenance, other');
      });
    });

    describe('Income validation', () => {
      it('should validate correct income row as new', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '1000',
          currency: 'USD',
          status: 'paid',
          date: '2024-01-15',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
      });

      it('should error if amount is missing', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '',
          currency: 'USD',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Amount is required for income');
      });

      it('should error if currency is invalid', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '1000',
          currency: 'JPY',
          date: '2024-01-01',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Invalid currency. Must be one of: USD, ILS, EUR, JOD');
      });

      it('accepts JOD as a valid currency (MUT-140)', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '1000.123',
          currency: 'JOD',
          status: 'paid',
          date: '2024-01-15',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
      });

      it('should error if status is invalid', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '1000',
          currency: 'USD',
          status: 'pending',
          date: '2024-01-01',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Invalid status for income. Must be: paid or unpaid');
      });

      it('should error if date is missing', () => {
        const row = {
          type: 'income',
          name: 'Payment',
          amount: '1000',
          currency: 'USD',
          date: '',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Date is required for income');
      });
    });

    describe('Expense validation', () => {
      it('should validate correct expense row as new', () => {
        const row = {
          type: 'expense',
          name: 'Office supplies',
          amount: '150.50',
          currency: 'USD',
          date: '2024-01-10',
          category: 'Office',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
      });

      it('should error if amount is missing', () => {
        const row = {
          type: 'expense',
          name: 'Supplies',
          amount: '',
          currency: 'USD',
          date: '2024-01-01',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Amount is required for expense');
      });

      it('should error if date is missing', () => {
        const row = {
          type: 'expense',
          name: 'Supplies',
          amount: '100',
          currency: 'USD',
          date: '',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Date is required for expense');
      });
    });

    describe('Conversion validation (MUT-141)', () => {
      it('should validate correct conversion row as new', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'JOD',
          toAmount: '704.50',
          toCurrency: 'USD',
          date: '2024-01-10',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.NEW);
        expect(result.errors).toHaveLength(0);
      });

      it('should error if toAmount is missing', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'JOD',
          toAmount: '',
          toCurrency: 'USD',
          date: '2024-01-10',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('To amount is required for conversion');
      });

      it('should error if toCurrency is missing', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'JOD',
          toAmount: '704.50',
          toCurrency: '',
          date: '2024-01-10',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('To currency is required for conversion');
      });

      it('should error if toCurrency is invalid', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'JOD',
          toAmount: '704.50',
          toCurrency: 'GBP',
          date: '2024-01-10',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Invalid to currency. Must be one of: USD, ILS, EUR, JOD');
      });

      it('should error if currency equals toCurrency', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'USD',
          toAmount: '450',
          toCurrency: 'USD',
          date: '2024-01-10',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('To currency must differ from currency');
      });

      it('should error if date is missing', () => {
        const row = {
          type: 'conversion',
          amount: '500',
          currency: 'JOD',
          toAmount: '704.50',
          toCurrency: 'USD',
          date: '',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Date is required for conversion');
      });
    });

    describe('General validation', () => {
      it('should error if type is invalid', () => {
        const row = {
          type: 'invalid',
          name: 'Test',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Invalid type. Must be one of: client, project, income, expense, conversion');
      });

      it('should error if type is missing', () => {
        const row = {
          type: '',
          name: 'Test',
        };

        const result = validateCSVRow(row, 0, []);

        expect(result.status).toBe(ValidationStatus.ERROR);
        expect(result.errors).toContain('Type is required');
      });
    });
  });
});
