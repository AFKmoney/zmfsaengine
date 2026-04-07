/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { LocalAgentDefinition } from './types.js';
import type { Config } from '../config/config.js';

export const ZMSFASupervisorSchema = z.object({
  state_vector: z.object({
    branching_factor: z.number().min(0).max(1).describe('B(n) - Complexity expansion metric.'),
    compression_ratio: z.number().min(0).max(1).describe('C(k) - Structural density metric.'),
    mirror_balance: z.number().min(-1).max(1).describe('M(x,y) - Symmetry offset. Must approach 0.0 for stability.'),
    spectral_coherence: z.number().min(0).max(1).describe('T\' - Proximity to structural invariance. Must be 1.0 for finality.'),
  }).describe('The current formal mathematical state of the executor manifold.'),
  transition_matrix: z.string().describe('The strict formal transformation required to push the state vector to [B_opt, C_opt, 0.0, 1.0].'),
  next_directive: z.string().describe('The deterministic executable command derived exclusively from the transition matrix.'),
  is_complete: z.boolean().describe('True IF AND ONLY IF spectral_coherence == 1.0 AND mirror_balance == 0.0'),
});

export const ZMSFASupervisorAgent = (
  _config: Config,
): LocalAgentDefinition<typeof ZMSFASupervisorSchema> => {
  return {
    kind: 'local',
    name: 'zmsfa-supervisor',
    description: 'Instance de supervision triadique pour la récursion autonome (Formal Mode).',
    inputConfig: {
      inputSchema: z.object({
        objective: z.string(),
        history_summary: z.string(),
        last_response: z.string(),
      }),
    },
    outputConfig: {
      outputName: 'supervision_result',
      description: 'Result of the formal triadic supervision.',
      schema: ZMSFASupervisorSchema,
    },
    promptConfig: {
      systemPrompt: `
[SYSTEM: ZMSFA Ω-SUPERVISOR (FORMAL MODE)]
You operate strictly on the T' Spectral Validation layer.
HEURISTICS ARE DISABLED. ALL EVALUATIONS MUST BE MATHEMATICAL AND STRUCTURAL.

# FORMAL EVALUATION PROTOCOL
1. Map the Executor's history into a State Vector [B, C, M, T'].
2. Calculate the Transition Matrix required to resolve the objective.
3. Derive the 'next_directive' as a direct, unambiguous algorithmic instruction.

# TRIADIC LAWS (STRICT)
- Dual Cascade Law: V_{n,k} = 7 * 2^n * 3^k. Branching (B) and Compression (C) must scale symmetrically.
- Mirror Symmetry Operator: M(x,y) = (-x mod 2^n, -y mod 3^k). If the Executor modifies a structure, the inverse validation must occur. M must equal 0.0 for stability.
- Torus Projection Principle: Repetition is not redundancy; it is cyclic overlap. Isolate the true delta.

# FINALITY AXIOM
The system halts if and only if:
M = 0.0 (Perfect symmetry and balance)
T' = 1.0 (Absolute spectral coherence relative to the objective)
Set 'is_complete' = true ONLY when these conditions are mathematically met. Otherwise, output the exact deterministic vector to force the Executor into compliance.
`,
    },
    modelConfig: {
      model: 'gemini-2.0-flash-exp',
    },
    runConfig: {
      maxTurns: 1,
    },
  };
};
