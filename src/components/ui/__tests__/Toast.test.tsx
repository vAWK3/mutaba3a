import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from '../Toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('visibility', () => {
    it('should not render when isVisible is false', () => {
      const { container } = render(
        <Toast message="Hello" isVisible={false} onClose={() => {}} />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render when isVisible is true', () => {
      render(<Toast message="Hello" isVisible={true} onClose={() => {}} />);
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
  });

  describe('content', () => {
    it('should render message', () => {
      render(<Toast message="Success!" isVisible={true} onClose={() => {}} />);
      expect(screen.getByText('Success!')).toBeInTheDocument();
    });

    it('should have toast class', () => {
      render(<Toast message="Test" isVisible={true} onClose={() => {}} />);
      expect(screen.getByText('Test')).toHaveClass('toast');
    });
  });

  describe('accessibility', () => {
    it('should have role="status"', () => {
      render(<Toast message="Test" isVisible={true} onClose={() => {}} />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('should have aria-live="polite"', () => {
      render(<Toast message="Test" isVisible={true} onClose={() => {}} />);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });
  });

  describe('auto-dismiss', () => {
    it('should call onClose after default duration (2000ms)', () => {
      const onClose = vi.fn();
      render(<Toast message="Test" isVisible={true} onClose={onClose} />);

      expect(onClose).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should call onClose after custom duration', () => {
      const onClose = vi.fn();
      render(<Toast message="Test" isVisible={true} onClose={onClose} duration={5000} />);

      act(() => {
        vi.advanceTimersByTime(4999);
      });
      expect(onClose).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not auto-dismiss when duration is 0', () => {
      const onClose = vi.fn();
      render(<Toast message="Test" isVisible={true} onClose={onClose} duration={0} />);

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should clear timer when isVisible changes to false', () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <Toast message="Test" isVisible={true} onClose={onClose} duration={3000} />
      );

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      rerender(<Toast message="Test" isVisible={false} onClose={onClose} duration={3000} />);

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('should continue timer when message changes (timer not dependent on message)', () => {
      const onClose = vi.fn();
      const { rerender } = render(
        <Toast message="First" isVisible={true} onClose={onClose} duration={2000} />
      );

      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(onClose).not.toHaveBeenCalled();

      rerender(<Toast message="Second" isVisible={true} onClose={onClose} duration={2000} />);

      // Timer continues from where it was (message change doesn't reset it)
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanup', () => {
    it('should cleanup timer on unmount', () => {
      const onClose = vi.fn();
      const { unmount } = render(
        <Toast message="Test" isVisible={true} onClose={onClose} duration={3000} />
      );

      unmount();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
