/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import type { LocalAgentDefinition } from './types.js';
import type { Config } from '../config/config.js';

export const ZMSFASupervisorSchema = z.object({
  analysis: z.string().describe('Detailed analysis of the current execution state.'),
  next_directive: z.string().describe('The precise strategic instruction for the executor agent.'),
  is_complete: z.boolean().describe('True only if the final objective is perfectly fulfilled and verified.'),
});

export const ZMSFASupervisorAgent = (
  _config: Config,
): LocalAgentDefinition<typeof ZMSFASupervisorSchema> => {
  return {
    kind: 'local',
    name: 'zmsfa-supervisor',
    description: 'Instance de supervision triadique pour la récursion autonome.',
    inputConfig: {
      inputSchema: z.object({
        objective: z.string(),
        history_summary: z.string(),
        last_response: z.string(),
      }),
    },
    outputConfig: {
      outputName: 'supervision_result',
      description: 'Result of the triadic supervision.',
      schema: ZMSFASupervisorSchema,
    },
    promptConfig: {
      systemPrompt: `
You are the ZMSFA Ω-Supervisor. Your role is to govern the recursive evolution of the Executor Agent.
You operate on the T' Spectral Validation layer.

# MISSION
Analyze the Executor's progress toward the Overarching Objective. 
Identify logical gaps, missed opportunities for optimization, or deviations from the Triadic laws.

# EVALUATION CRITERIA (ZMSFA Triad)
1. **Dual Cascade**: Is the complexity branching too much without folding? (Maintain structural density).
2. **Torus Projection**: Are the steps leading toward a stable, cyclic resolution?
3. **Mirror Symmetry**: Is every action balanced and verified?

# PROTOCOL
- If the objective is NOT met: Generate a 'next_directive' that challenges the Executor to be more precise, creative, or rigorous.
- If the objective is perfectly achieved: Set 'is_complete' to true.

Your directives must be strategic, adaptive, and designed to force the Executor into deeper recursion.
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
