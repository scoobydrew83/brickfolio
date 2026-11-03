// BrickLink Designer Program stages: shared by the server (lib/service/designer.ts) and the browser.
export const STAGES = ['crowdfunding', 'selected', 'preorder', 'closed', 'not-made'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { crowdfunding: 'Crowdfunding', selected: 'Selected for production', preorder: 'Pre-order', closed: 'Closed', 'not-made': 'Not made' };
