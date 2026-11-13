import { ashby } from './ashby.js';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { smartrecruiters } from './smartrecruiters.js';
import { workable } from './workable.js';
import type { AtsConnector } from './types.js';

// Authorized ATS submission connectors, by provider. Kept in step with PROVIDER_SUBMISSION[...]
// .connectorImplemented in packages/shared/src/applyPipeline.ts (a test checks it).
export const CONNECTORS_BY_PROVIDER: Record<string, AtsConnector> = { greenhouse, lever, ashby, smartrecruiters, workable };

export * from './types.js';
