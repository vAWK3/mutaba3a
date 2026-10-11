/**
 * Documents download as a top-level navigation to the server's 15-minute signed
 * URL (`Content-Disposition: attachment`), so the file is saved, never rendered
 * inside the portal (ADR-028; hosted-portal.md §7.3). An object, so tests can
 * replace `open` without a real navigation.
 */
export const downloadNavigator = {
  open(url: string): void {
    window.location.assign(url);
  },
};
