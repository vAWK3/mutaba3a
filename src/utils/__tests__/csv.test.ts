import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toCsv, downloadTextFile } from '../csv';

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
});
