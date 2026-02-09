import { useT } from '../../lib/i18n';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
  totalItems?: number;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  pageSize,
  totalItems,
}: PaginationProps) {
  const t = useT();

  if (totalPages <= 1) {
    return null;
  }

  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  // Calculate range
  const startItem = pageSize ? (currentPage - 1) * pageSize + 1 : undefined;
  const endItem = pageSize && totalItems
    ? Math.min(currentPage * pageSize, totalItems)
    : undefined;

  return (
    <div className="pagination">
      <div className="pagination-info">
        {startItem && endItem && totalItems && (
          <span className="text-secondary text-sm">
            {startItem}–{endItem} of {totalItems}
          </span>
        )}
      </div>
      <div className="pagination-controls">
        <button
          className="btn btn-icon btn-secondary"
          onClick={handlePrevious}
          disabled={currentPage === 1}
          aria-label={t('common.previous')}
        >
          <ChevronLeftIcon size={16} />
        </button>
        <span className="pagination-current">
          {currentPage} / {totalPages}
        </span>
        <button
          className="btn btn-icon btn-secondary"
          onClick={handleNext}
          disabled={currentPage === totalPages}
          aria-label={t('common.next')}
        >
          <ChevronRightIcon size={16} />
        </button>
      </div>
    </div>
  );
}
