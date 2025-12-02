/** PR event actions that use pull_request.base.sha and pull_request.head.sha */
export const PR_BASED_ACTIONS = [
  "opened",
  "reopened",
  "ready_for_review",
] as const;

/** All supported actions for SHA auto-detection */
export const SUPPORTED_ACTIONS = [...PR_BASED_ACTIONS, "synchronize"] as const;

export type PrBasedAction = (typeof PR_BASED_ACTIONS)[number];
export type SupportedAction = (typeof SUPPORTED_ACTIONS)[number];

/** Type guard for PR-based actions (opened, reopened, ready_for_review) */
export function isPrBasedAction(
  action: string | undefined
): action is PrBasedAction {
  return !!action && PR_BASED_ACTIONS.includes(action as PrBasedAction);
}

/** Type guard for all supported actions */
export function isSupportedAction(
  action: string | undefined
): action is SupportedAction {
  return !!action && SUPPORTED_ACTIONS.includes(action as SupportedAction);
}
