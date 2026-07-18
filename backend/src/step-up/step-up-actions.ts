export const STEP_UP_ACTION_DEFINITIONS = {
  'user.privileged.create': { resourceType: 'user_collection', enforcement: 'candidate' },
  'user.role.update': { resourceType: 'user', enforcement: 'attached' },
  'user.password.reset': { resourceType: 'user', enforcement: 'attached' },
  'user.status.update': { resourceType: 'user', enforcement: 'attached' },
  'user.disable': { resourceType: 'user', enforcement: 'attached' },
  'work_order.boss_approve': { resourceType: 'work_order', enforcement: 'attached' },
  'import.confirm': { resourceType: 'import_task', enforcement: 'attached' },
  'ocr.confirm': { resourceType: 'ocr_task', enforcement: 'attached' },
  'record.confirm': { resourceType: 'business_record', enforcement: 'attached' },
  'retention.run.create': { resourceType: 'retention_class', enforcement: 'candidate' },
  'retention.legal_hold.create': { resourceType: 'retention_resource', enforcement: 'attached' },
  'model.route.update': { resourceType: 'model_route', enforcement: 'candidate' }
} as const;

export type StepUpAction = keyof typeof STEP_UP_ACTION_DEFINITIONS;
export type StepUpResourceType = (typeof STEP_UP_ACTION_DEFINITIONS)[StepUpAction]['resourceType'];

export const STEP_UP_ACTIONS = Object.freeze(Object.keys(STEP_UP_ACTION_DEFINITIONS) as StepUpAction[]);

export function stepUpDefinition(action: StepUpAction) {
  return STEP_UP_ACTION_DEFINITIONS[action];
}
