/** MUT-570: Documents' tabs where issuing is on: Issued, To issue (MUT-660) and Files. */
export function documentTabs(profileId: string, t: (key: string) => string) {
  return {
    label: t('hosted.issue.tabsLabel'),
    tabs: [
      { to: `/p/${profileId}/documents/issued`, label: t('hosted.issue.tabIssued') },
      { to: `/p/${profileId}/documents/to-issue`, label: t('hosted.documentsDue.tab') },
      { to: `/p/${profileId}/documents`, label: t('hosted.issue.tabFiles'), exact: true },
    ],
  };
}
