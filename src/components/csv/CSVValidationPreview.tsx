import { useState, useMemo } from 'react';
import { ValidationStatus, type CSVValidationResult } from '../../utils/csvValidation';
import './CSVValidationPreview.css';

interface CSVValidationPreviewProps {
  results: CSVValidationResult[];
  onSelectionChange: (selectedIndices: number[]) => void;
}

export function CSVValidationPreview({ results, onSelectionChange }: CSVValidationPreviewProps) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => {
    // By default, select all rows that are not errors
    const initialSelection = new Set<number>();
    results.forEach((result, index) => {
      if (result.status !== ValidationStatus.ERROR) {
        initialSelection.add(index);
      }
    });
    return initialSelection;
  });

  const stats = useMemo(() => {
    return {
      total: results.length,
      new: results.filter(r => r.status === ValidationStatus.NEW).length,
      duplicate: results.filter(r => r.status === ValidationStatus.DUPLICATE).length,
      error: results.filter(r => r.status === ValidationStatus.ERROR).length,
      selected: selectedRows.size,
    };
  }, [results, selectedRows]);

  const handleToggleAll = () => {
    if (selectedRows.size === results.length) {
      // Deselect all
      setSelectedRows(new Set());
      onSelectionChange([]);
    } else {
      // Select all non-error rows
      const allValid = new Set<number>();
      results.forEach((result, index) => {
        if (result.status !== ValidationStatus.ERROR) {
          allValid.add(index);
        }
      });
      setSelectedRows(allValid);
      onSelectionChange(Array.from(allValid));
    }
  };

  const handleToggleRow = (index: number) => {
    const newSelection = new Set(selectedRows);
    if (newSelection.has(index)) {
      newSelection.delete(index);
    } else {
      newSelection.add(index);
    }
    setSelectedRows(newSelection);
    onSelectionChange(Array.from(newSelection));
  };

  const getStatusIcon = (status: ValidationStatus) => {
    switch (status) {
      case ValidationStatus.NEW:
        return <span className="status-icon status-new">✓</span>;
      case ValidationStatus.DUPLICATE:
        return <span className="status-icon status-duplicate">⚠</span>;
      case ValidationStatus.ERROR:
        return <span className="status-icon status-error">✕</span>;
    }
  };

  const getStatusText = (status: ValidationStatus) => {
    switch (status) {
      case ValidationStatus.NEW:
        return 'New';
      case ValidationStatus.DUPLICATE:
        return 'Duplicate';
      case ValidationStatus.ERROR:
        return 'Error';
    }
  };

  return (
    <div className="csv-validation-preview">
      {/* Stats Summary */}
      <div className="validation-stats">
        <div className="stat">
          <span className="stat-label">Total Rows:</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat stat-new">
          <span className="stat-label">New:</span>
          <span className="stat-value">{stats.new}</span>
        </div>
        <div className="stat stat-duplicate">
          <span className="stat-label">Duplicates:</span>
          <span className="stat-value">{stats.duplicate}</span>
        </div>
        <div className="stat stat-error">
          <span className="stat-label">Errors:</span>
          <span className="stat-value">{stats.error}</span>
        </div>
        <div className="stat stat-selected">
          <span className="stat-label">Selected:</span>
          <span className="stat-value">{stats.selected}</span>
        </div>
      </div>

      {/* Table */}
      <div className="validation-table-container">
        <table className="validation-table">
          <thead>
            <tr>
              <th className="col-checkbox">
                <input
                  type="checkbox"
                  checked={selectedRows.size > 0 && selectedRows.size === results.filter(r => r.status !== ValidationStatus.ERROR).length}
                  onChange={handleToggleAll}
                  title="Toggle all"
                />
              </th>
              <th className="col-status">Status</th>
              <th className="col-type">Type</th>
              <th className="col-name">Name</th>
              <th className="col-details">Details</th>
              <th className="col-issues">Issues</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => {
              const isSelected = selectedRows.has(index);
              const isError = result.status === ValidationStatus.ERROR;
              const rowClass = `validation-row ${result.status} ${isSelected ? 'selected' : ''}`;

              return (
                <tr key={index} className={rowClass}>
                  <td className="col-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleRow(index)}
                      disabled={isError}
                      title={isError ? 'Cannot import row with errors' : 'Toggle selection'}
                    />
                  </td>
                  <td className="col-status">
                    {getStatusIcon(result.status)}
                    <span className="status-text">{getStatusText(result.status)}</span>
                  </td>
                  <td className="col-type">
                    <span className="type-badge">{result.data.type}</span>
                  </td>
                  <td className="col-name">
                    {result.data.name || <span className="text-muted">(no name)</span>}
                  </td>
                  <td className="col-details">
                    {result.data.type === 'client' && (
                      <div className="details-text">
                        {result.data.email && <div>{result.data.email}</div>}
                        {result.data.phone && <div>{result.data.phone}</div>}
                      </div>
                    )}
                    {result.data.type === 'project' && (
                      <div className="details-text">
                        {result.data.client && <div>Client: {result.data.client}</div>}
                        {result.data.field && <div>Field: {result.data.field}</div>}
                      </div>
                    )}
                    {(result.data.type === 'income' || result.data.type === 'expense') && (
                      <div className="details-text">
                        {result.data.amount && result.data.currency && (
                          <div>{result.data.amount} {result.data.currency}</div>
                        )}
                        {result.data.date && <div>Date: {result.data.date}</div>}
                        {result.data.type === 'income' && result.data.status && (
                          <div>Status: {result.data.status}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="col-issues">
                    {result.errors.length > 0 && (
                      <div className="issues-list errors">
                        {result.errors.map((error, i) => (
                          <div key={i} className="issue error">
                            <span className="issue-icon">✕</span>
                            {error}
                          </div>
                        ))}
                      </div>
                    )}
                    {result.warnings.length > 0 && (
                      <div className="issues-list warnings">
                        {result.warnings.map((warning, i) => (
                          <div key={i} className="issue warning">
                            <span className="issue-icon">⚠</span>
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {stats.error > 0 && (
        <div className="validation-notice error-notice">
          <span className="notice-icon">⚠</span>
          <span>
            {stats.error} row{stats.error > 1 ? 's' : ''} with errors will not be imported.
            Please fix the errors and re-upload the CSV.
          </span>
        </div>
      )}

      {stats.duplicate > 0 && (
        <div className="validation-notice duplicate-notice">
          <span className="notice-icon">ℹ</span>
          <span>
            {stats.duplicate} duplicate{stats.duplicate > 1 ? 's' : ''} detected.
            Existing records will be reused instead of creating duplicates.
          </span>
        </div>
      )}
    </div>
  );
}
