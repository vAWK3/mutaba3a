/** MUT-570: Documents' two tabs where issuing is on: Issued and Files. */
export function documentTabs(profileId: string, t: (key: string) => string) {
  return {
    label: t('hosted.issue.tabsLabel'),
    tabs: [
      { to: `/p/${profileId}/documents/issued`, label: t('hosted.issue.tabIssued') },
      { to: `/p/${profileId}/documents`, label: t('hosted.issue.tabFiles'), exact: true },
    ],
  };
}
