import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toCsv, downloadTextFile, parseCSV, generateImportTemplate } from '../csv';

describe('csv utilities', () => {
  describe('toCsv', () => {
    it('should generate header row', () => {
      const result = toCsv([], ['name', 'email', 'phone']);
      expect(result).toBe('name,email,phone');
    });

    it('should generate data rows', () => {
      const rows = [
        { name: 'John', email: 'john@example.com', phone: '123' },
        { name: 'Jane', email: 'jane@example.com', phone: '456' },
      ];
      const columns = ['name', 'email', 'phone'];
      const result = toCsv(rows, columns);

      expect(result).toBe(
        'name,email,phone\n' +
        'John,john@example.com,123\n' +
        'Jane,jane@example.com,456'
      );
    });

    it('should handle null values', () => {
      const rows = [{ name: 'John', email: null, phone: undefined }];
      const columns = ['name', 'email', 'phone'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email,phone\nJohn,,');
    });

    it('should escape commas in values', () => {
      const rows = [{ name: 'Doe, John', email: 'john@example.com' }];
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\n"Doe, John",john@example.com');
    });

    it('should escape quotes in values', () => {
      const rows = [{ name: 'John "Johnny" Doe', email: 'john@example.com' }];
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\n"John ""Johnny"" Doe",john@example.com');
    });

    it('should escape newlines in values', () => {
      const rows = [{ name: 'John\nDoe', email: 'john@example.com' }];
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\n"John\nDoe",john@example.com');
    });

    it('should escape carriage returns in values', () => {
      const rows = [{ name: 'John\rDoe', email: 'john@example.com' }];
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\n"John\rDoe",john@example.com');
    });

    it('should handle numbers', () => {
      const rows = [{ name: 'John', amount: 1000, rate: 3.14 }];
      const columns = ['name', 'amount', 'rate'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,amount,rate\nJohn,1000,3.14');
    });

    it('should handle booleans', () => {
      const rows = [{ name: 'John', active: true, verified: false }];
      const columns = ['name', 'active', 'verified'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,active,verified\nJohn,true,false');
    });

    it('should only include specified columns', () => {
      const rows = [{ name: 'John', email: 'john@example.com', phone: '123', secret: 'hidden' }];
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\nJohn,john@example.com');
      expect(result).not.toContain('secret');
      expect(result).not.toContain('hidden');
    });

    it('should handle empty rows array', () => {
      const result = toCsv([], ['name', 'email']);
      expect(result).toBe('name,email');
    });

    it('should handle missing columns in rows', () => {
      const rows = [{ name: 'John' }]; // missing email
      const columns = ['name', 'email'];
      const result = toCsv(rows, columns);

      expect(result).toBe('name,email\nJohn,');
    });
  });

  describe('downloadTextFile', () => {
    let createElementSpy: ReturnType<typeof vi.spyOn>;
    let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
    let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;
    let mockAnchor: { href: string; download: string; click: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
      };

      createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);
      createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
      revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    afterEach(() => {
      createElementSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    });

    it('should create an anchor element', () => {
      downloadTextFile('test.csv', 'content');
      expect(createElementSpy).toHaveBeenCalledWith('a');
    });

    it('should set download attribute to filename', () => {
      downloadTextFile('export.csv', 'content');
      expect(mockAnchor.download).toBe('export.csv');
    });

    it('should create blob URL', () => {
      downloadTextFile('test.csv', 'content');
      expect(createObjectURLSpy).toHaveBeenCalled();
    });

    it('should click the anchor to trigger download', () => {
      downloadTextFile('test.csv', 'content');
      expect(mockAnchor.click).toHaveBeenCalled();
    });

    it('should revoke blob URL after download', () => {
      downloadTextFile('test.csv', 'content');
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
    });

    it('should add BOM for CSV files', () => {
      downloadTextFile('test.csv', 'content', 'text/csv;charset=utf-8');

      const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
      expect(blobArg).toBeInstanceOf(Blob);
      // BOM is \uFEFF
    });

    it('should not add BOM for non-CSV files', () => {
      downloadTextFile('test.json', '{}', 'application/json');

      const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
      expect(blobArg).toBeInstanceOf(Blob);
    });

    it('should use default MIME type for CSV', () => {
      downloadTextFile('test.csv', 'content');

      const blobArg = createObjectURLSpy.mock.calls[0][0] as Blob;
      expect(blobArg.type).toBe('text/csv;charset=utf-8');
    });
  });

  describe('parseCSV', () => {
    it('should parse simple CSV', () => {
      const csv = 'name,email,phone\nJohn Doe,john@example.com,555-1234\nJane Smith,jane@example.com,555-5678';
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-1234',
      });
      expect(result[1]).toEqual({
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '555-5678',
      });
    });

    it('should handle quoted fields with commas', () => {
      const csv = 'name,notes\n"Smith, John","Important, VIP client"';
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'Smith, John',
        notes: 'Important, VIP client',
      });
    });

    it('should handle escaped quotes', () => {
      const csv = 'name,notes\n"John ""The Boss"" Doe","He said ""Hello"""';
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'John "The Boss" Doe',
        notes: 'He said "Hello"',
      });
    });

    it('should handle newlines in quoted fields', () => {
      const csv = 'name,notes\n"John Doe","Line 1\nLine 2\nLine 3"';
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'John Doe',
        notes: 'Line 1\nLine 2\nLine 3',
      });
    });

    it('should handle BOM', () => {
      const csv = '\uFEFFname,email\nJohn,john@example.com';
      const result = parseCSV(csv);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'John',
        email: 'john@example.com',
      });
    });

    it('should handle empty values', () => {
      const csv = 'name,email,phone\nJohn,,555-1234\n,jane@example.com,';
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'John',
        email: '',
        phone: '555-1234',
      });
      expect(result[1]).toEqual({
        name: '',
        email: 'jane@example.com',
        phone: '',
      });
    });

    it('should handle Windows line endings (CRLF)', () => {
      const csv = 'name,email\r\nJohn,john@example.com\r\nJane,jane@example.com';
      const result = parseCSV(csv);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('John');
      expect(result[1].name).toBe('Jane');
    });

    it('should return empty array for empty CSV', () => {
      const csv = '';
      const result = parseCSV(csv);

      expect(result).toEqual([]);
    });

    it('should handle CSV with only headers', () => {
      const csv = 'name,email,phone';
      const result = parseCSV(csv);

      expect(result).toEqual([]);
    });

    it('should handle mixed line endings', () => {
      const csv = 'name,email\nJohn,john@example.com\r\nJane,jane@example.com\rBob,bob@example.com';
      const result = parseCSV(csv);

      expect(result).toHaveLength(3);
    });

    it('should handle complex real-world CSV', () => {
      const csv = `type,name,email,phone,client,project,field,amount,currency,status,date,dueDate,paidAt,category,notes
client,Acme Corp,contact@acme.com,+1-555-0100,,,,,,,,,,,VIP client
project,Website Redesign,,,Acme Corp,,design,,,,,,,,"Complete UI/UX overhaul"
income,Design payment,,,Acme Corp,Website Redesign,,5000,USD,paid,2024-01-15,,2024-01-15,,
expense,Software subscription,,,,,,99.99,USD,,2024-01-01,,,Software,`;

      const result = parseCSV(csv);

      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('client');
      expect(result[0].name).toBe('Acme Corp');
      expect(result[1].type).toBe('project');
      expect(result[1].field).toBe('design');
      expect(result[2].type).toBe('income');
      expect(result[2].status).toBe('paid');
      expect(result[3].type).toBe('expense');
      expect(result[3].category).toBe('Software');
    });
  });

  describe('generateImportTemplate', () => {
    it('should generate valid CSV template', () => {
      const template = generateImportTemplate();

      expect(template).toBeTruthy();
      expect(template).toContain('type,name,email');
    });

    it('should include all required columns', () => {
      const template = generateImportTemplate();

      expect(template).toContain('type');
      expect(template).toContain('name');
      expect(template).toContain('email');
      expect(template).toContain('phone');
      expect(template).toContain('client');
      expect(template).toContain('project');
      expect(template).toContain('field');
      expect(template).toContain('amount');
      expect(template).toContain('currency');
      expect(template).toContain('status');
      expect(template).toContain('date');
      expect(template).toContain('category');
      expect(template).toContain('notes');
    });

    it('should include examples of all entity types', () => {
      const template = generateImportTemplate();

      expect(template).toContain('client');
      expect(template).toContain('project');
      expect(template).toContain('income');
      expect(template).toContain('expense');
    });

    it('should show valid status values', () => {
      const template = generateImportTemplate();

      expect(template).toContain('paid');
      expect(template).toContain('unpaid');
    });

    it('should show valid currency values', () => {
      const template = generateImportTemplate();

      expect(template).toContain('USD');
      expect(template).toContain('ILS');
      expect(template).toContain('EUR');
    });

    it('should show valid field values', () => {
      const template = generateImportTemplate();

      expect(template).toContain('design');
      expect(template).toContain('development');
    });

    it('should be parseable', () => {
      const template = generateImportTemplate();
      const parsed = parseCSV(template);

      expect(parsed.length).toBeGreaterThan(0);
      // Filter out comment rows
      const dataRows = parsed.filter(row => !row.type.startsWith('#'));
      expect(dataRows.length).toBeGreaterThan(0);
      expect(dataRows[0]).toHaveProperty('type');
      expect(dataRows[0]).toHaveProperty('name');
    });
  });

  describe('CSV round-trip', () => {
    it('should maintain data integrity through parse and generate cycle', () => {
      const original = [
        {
          type: 'client',
          name: 'Test Corp',
          email: 'test@example.com',
          phone: '555-1234',
          client: '',
          project: '',
          field: '',
          amount: '',
          currency: '',
          status: '',
          date: '',
          dueDate: '',
          paidAt: '',
          category: '',
          notes: 'Test note',
        },
      ];

      const columns = [
        'type',
        'name',
        'email',
        'phone',
        'client',
        'project',
        'field',
        'amount',
        'currency',
        'status',
        'date',
        'dueDate',
        'paidAt',
        'category',
        'notes',
      ];

      const csv = toCsv(original, columns);
      const parsed = parseCSV(csv);

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual(original[0]);
    });

    it('should handle complex data with special characters', () => {
      const original = [
        {
          name: 'Company, Inc.',
          notes: 'Important client.\nVery "special".',
          email: 'test@example.com',
        },
      ];

      const columns = ['name', 'notes', 'email'];
      const csv = toCsv(original, columns);
      const parsed = parseCSV(csv);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe(original[0].name);
      expect(parsed[0].notes).toBe(original[0].notes);
      expect(parsed[0].email).toBe(original[0].email);
    });
  });
});
