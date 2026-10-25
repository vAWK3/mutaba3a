import { useMe } from './me';

/**
 * MUT-434: whether the signed-in person holds an operator-granted feature (MUT-433), from /v1/me. The server still
 * checks every call; this only hides what the person can't use. Only valid under the authenticated routes.
 */
export function useHasFeature(feature: 'agent_access'): boolean {
  return useMe().user.features.includes(feature);
}
