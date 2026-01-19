import { useEffect, useCallback } from 'react';

export interface DocumentKeyboardShortcutsOptions {
  /** Handler for Cmd/Ctrl+S (Save) */
  onSave?: () => void;
  /** Handler for Cmd/Ctrl+Enter (Issue) */
  onIssue?: () => void;
  /** Handler for Escape (Cancel/Close) */
  onCancel?: () => void;
  /** Whether save is currently in progress */
  isSaving?: boolean;
  /** Whether issue is currently in progress */
  isIssuing?: boolean;
  /** Whether the issue action is available */
  canIssue?: boolean;
  /** Whether shortcuts are enabled (default: true) */
  enabled?: boolean;
}

/**
 * Hook for document editor keyboard shortcuts.
 *
 * Supported shortcuts:
 * - Cmd/Ctrl+S: Save draft
 * - Cmd/Ctrl+Enter: Issue document
 * - Escape: Cancel/Close
 */
export function useDocumentKeyboardShortcuts({
  onSave,
  onIssue,
  onCancel,
  isSaving = false,
  isIssuing = false,
  canIssue = false,
  enabled = true,
}: DocumentKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      // Don't trigger shortcuts when typing in inputs (except for specific keys)
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable;

      // Cmd/Ctrl + S: Save draft
      if (modifier && e.key === 's') {
        e.preventDefault();
        if (onSave && !isSaving) {
          onSave();
        }
        return;
      }

      // Cmd/Ctrl + Enter: Issue document
      if (modifier && e.key === 'Enter') {
        e.preventDefault();
        if (onIssue && canIssue && !isIssuing) {
          onIssue();
        }
        return;
      }

      // Escape: Cancel/Close (only if not in an input)
      if (e.key === 'Escape' && !isInput) {
        e.preventDefault();
        if (onCancel) {
          onCancel();
        }
        return;
      }
    },
    [enabled, onSave, onIssue, onCancel, isSaving, isIssuing, canIssue]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Returns platform-specific keyboard shortcut symbols.
 */
export function getKeyboardShortcutSymbols() {
  const isMac = typeof navigator !== 'undefined' &&
                navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  return {
    modifier: isMac ? '⌘' : 'Ctrl',
    save: isMac ? '⌘S' : 'Ctrl+S',
    issue: isMac ? '⌘↵' : 'Ctrl+Enter',
    escape: 'Esc',
  };
}
