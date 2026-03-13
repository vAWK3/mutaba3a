import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToastStore, useToast } from '../toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    const { result } = renderHook(() => useToastStore());
    act(() => {
      result.current.toasts.forEach((toast) => {
        result.current.removeToast(toast.id);
      });
    });
  });

  describe('useToastStore', () => {
    it('should start with empty toasts', () => {
      const { result } = renderHook(() => useToastStore());
      expect(result.current.toasts).toEqual([]);
    });

    it('should add a toast', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({
          message: 'Test toast',
          duration: 3000,
        });
      });

      expect(result.current.toasts).toHaveLength(1);
      expect(result.current.toasts[0].message).toBe('Test toast');
      expect(result.current.toasts[0].duration).toBe(3000);
    });

    it('should add toast with action', () => {
      const { result } = renderHook(() => useToastStore());
      const onClick = () => {};

      act(() => {
        result.current.addToast({
          message: 'Action toast',
          duration: 5000,
          action: {
            label: 'Undo',
            onClick,
          },
        });
      });

      expect(result.current.toasts[0].action?.label).toBe('Undo');
    });

    it('should return toast ID when adding', () => {
      const { result } = renderHook(() => useToastStore());

      let id: string = '';
      act(() => {
        id = result.current.addToast({
          message: 'Test toast',
          duration: 3000,
        });
      });

      expect(id).toBeTruthy();
      expect(id).toMatch(/^toast-\d+$/);
    });

    it('should remove a toast', () => {
      const { result } = renderHook(() => useToastStore());

      let id: string = '';
      act(() => {
        id = result.current.addToast({
          message: 'Test toast',
          duration: 3000,
        });
      });

      expect(result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.removeToast(id);
      });

      expect(result.current.toasts).toHaveLength(0);
    });

    it('should handle multiple toasts', () => {
      const { result } = renderHook(() => useToastStore());

      act(() => {
        result.current.addToast({ message: 'Toast 1', duration: 3000 });
        result.current.addToast({ message: 'Toast 2', duration: 3000 });
        result.current.addToast({ message: 'Toast 3', duration: 3000 });
      });

      expect(result.current.toasts).toHaveLength(3);
    });

    it('should generate unique IDs', () => {
      const { result } = renderHook(() => useToastStore());

      const ids: string[] = [];
      act(() => {
        ids.push(result.current.addToast({ message: 'Toast 1', duration: 3000 }));
        ids.push(result.current.addToast({ message: 'Toast 2', duration: 3000 }));
        ids.push(result.current.addToast({ message: 'Toast 3', duration: 3000 }));
      });

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe('useToast', () => {
    it('should show toast with default duration', () => {
      const storeHook = renderHook(() => useToastStore());
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test message');
      });

      expect(storeHook.result.current.toasts).toHaveLength(1);
      expect(storeHook.result.current.toasts[0].message).toBe('Test message');
      expect(storeHook.result.current.toasts[0].duration).toBe(3000);
    });

    it('should show toast with longer duration when action provided', () => {
      const storeHook = renderHook(() => useToastStore());
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test message', {
          action: { label: 'Undo', onClick: () => {} },
        });
      });

      expect(storeHook.result.current.toasts[0].duration).toBe(5000);
    });

    it('should show toast with custom duration', () => {
      const storeHook = renderHook(() => useToastStore());
      const { result } = renderHook(() => useToast());

      act(() => {
        result.current.showToast('Test message', {
          duration: 10000,
        });
      });

      expect(storeHook.result.current.toasts[0].duration).toBe(10000);
    });

    it('should allow removing toast', () => {
      const storeHook = renderHook(() => useToastStore());
      const { result } = renderHook(() => useToast());

      let id: string = '';
      act(() => {
        id = result.current.showToast('Test message');
      });

      expect(storeHook.result.current.toasts).toHaveLength(1);

      act(() => {
        result.current.removeToast(id);
      });

      expect(storeHook.result.current.toasts).toHaveLength(0);
    });
  });
});
