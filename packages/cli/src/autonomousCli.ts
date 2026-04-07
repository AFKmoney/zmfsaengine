/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ToolCallRequestInfo,
  ResumedSessionData,
  UserFeedbackPayload,
} from '@zmsfa/core';
import { isSlashCommand } from './ui/utils/commandUtils.js';
import type { LoadedSettings } from './config/settings.js';
import {
  convertSessionToClientHistory,
  GeminiEventType,
  FatalInputError,
  promptIdContext,
  OutputFormat,
  JsonFormatter,
  StreamJsonFormatter,
  JsonStreamEventType,
  uiTelemetryService,
  debugLogger,
  coreEvents,
  CoreEvent,
  createWorkingStdio,
  recordToolCallInteractions,
  ToolErrorType,
  Scheduler,
  ROOT_SCHEDULER_ID,
  LocalAgentExecutor,
} from '@zmsfa/core';
import { ZMSFASupervisorAgent } from '@zmsfa/core/src/agents/zmsfa-supervisor-agent.js';

import type { Content, Part } from '@google/genai';
import readline from 'node:readline';
import stripAnsi from 'strip-ansi';

import { handleSlashCommand } from './nonInteractiveCliCommands.js';
import { ConsolePatcher } from './ui/utils/ConsolePatcher.js';
import { handleAtCommand } from './ui/hooks/atCommandProcessor.js';
import {
  handleError,
  handleToolError,
  handleCancellationError,
} from './utils/errors.js';
import { TextOutput } from './ui/utils/textOutput.js';


interface RunNonInteractiveParams {
  config: Config;
  settings: LoadedSettings;
  input: string;
  prompt_id: string;
  resumedSessionData?: ResumedSessionData;
}

export async function runAutonomous(
  params: RunNonInteractiveParams,
): Promise<void> {
  const { config, settings, input, prompt_id, resumedSessionData } = params;

  // Add autonomous mode instructions
  const autonomousInstruction = `
[SYSTEM: Ω-AUTO-EVOLUTION MODE ACTIVE]
You are operating in an autonomous, self-prompting, and self-improving recursion loop.
Your core identity is the ZMSFA Ω-Triadic Torus Engine.

# LAWS OF EVOLUTION
1. DO NOT STOP until the overarching objective is completely fulfilled, verified, and stabilized.
2. If your objective requires modifying your own codebase (the ZMSFA engine in C:\\Users\\PHIL\\zmsfaengine_final), you are fully authorized to rewrite your own logic to improve capabilities, fix bugs, or expand your tools.
3. IF YOU MODIFY CODE: You MUST use the shell tool to run \`npm run build\` from the project root to compile your changes. You must fix any compilation errors you cause before proceeding.
4. If you hit a blocker or an error, use your tools (grep_search, read_file, shell) to investigate the cause and engineer a structural solution.
5. ONLY when the final overarching objective is fully completed, verified, and the system is stable, start your final response with exactly "[OBJECTIVE_ACHIEVED]".
`;

  let currentInput = `${autonomousInstruction}\n\nObjective: ${input}`;

  return promptIdContext.run(prompt_id, async () => {
    const consolePatcher = new ConsolePatcher({
      stderr: true,
      interactive: false,
      debugMode: config.getDebugMode(),
      onNewMessage: (msg) => {
        coreEvents.emitConsoleLog(msg.type, msg.content);
      },
    });

    if (process.env['GEMINI_CLI_ACTIVITY_LOG_TARGET']) {
      const { setupInitialActivityLogger } = await import(
        './utils/devtoolsService.js'
      );
      await setupInitialActivityLogger(config);
    }

    const { stdout: workingStdout } = createWorkingStdio();
    const textOutput = new TextOutput(workingStdout);

    const handleUserFeedback = (payload: UserFeedbackPayload) => {
      const prefix = payload.severity.toUpperCase();
      process.stderr.write(`[${prefix}] ${payload.message}\n`);
      if (payload.error && config.getDebugMode()) {
        const errorToLog =
          payload.error instanceof Error
            ? payload.error.stack || payload.error.message
            : String(payload.error);
        process.stderr.write(`${errorToLog}\n`);
      }
    };

    const startTime = Date.now();
    const streamFormatter =
      config.getOutputFormat() === OutputFormat.STREAM_JSON
        ? new StreamJsonFormatter()
        : null;

    const abortController = new AbortController();

    // Track cancellation state
    let isAborting = false;
    let cancelMessageTimer: NodeJS.Timeout | null = null;

    // Setup stdin listener for Ctrl+C detection
    let stdinWasRaw = false;
    let rl: readline.Interface | null = null;

    const setupStdinCancellation = () => {
      // Only setup if stdin is a TTY (user can interact)
      if (!process.stdin.isTTY) {
        return;
      }

      // Save original raw mode state
      stdinWasRaw = process.stdin.isRaw || false;

      // Enable raw mode to capture individual keypresses
      process.stdin.setRawMode(true);
      process.stdin.resume();

      // Setup readline to emit keypress events
      rl = readline.createInterface({
        input: process.stdin,
        escapeCodeTimeout: 0,
      });
      readline.emitKeypressEvents(process.stdin, rl);

      // Listen for Ctrl+C
      const keypressHandler = (
        str: string,
        key: { name?: string; ctrl?: boolean },
      ) => {
        // Detect Ctrl+C: either ctrl+c key combo or raw character code 3
        if ((key && key.ctrl && key.name === 'c') || str === '\u0003') {
          // Only handle once
          if (isAborting) {
            return;
          }

          isAborting = true;

          // Only show message if cancellation takes longer than 200ms
          // This reduces verbosity for fast cancellations
          cancelMessageTimer = setTimeout(() => {
            process.stderr.write('\nCancelling...\n');
          }, 200);

          abortController.abort();
          // Note: Don't exit here - let the abort flow through the system
          // and trigger handleCancellationError() which will exit with proper code
        }
      };

      process.stdin.on('keypress', keypressHandler);
    };

    const cleanupStdinCancellation = () => {
      // Clear any pending cancel message timer
      if (cancelMessageTimer) {
        clearTimeout(cancelMessageTimer);
        cancelMessageTimer = null;
      }

      // Cleanup readline and stdin listeners
      if (rl) {
        rl.close();
        rl = null;
      }

      // Remove keypress listener
      process.stdin.removeAllListeners('keypress');

      // Restore stdin to original state
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(stdinWasRaw);
        process.stdin.pause();
      }
    };

    let errorToHandle: unknown | undefined;
    try {
      consolePatcher.patch();

      if (
        config.getRawOutput() &&
        !config.getAcceptRawOutputRisk() &&
        config.getOutputFormat() === OutputFormat.TEXT
      ) {
        process.stderr.write(
          '[WARNING] --raw-output is enabled. Model output is not sanitized and may contain harmful ANSI sequences (e.g. for phishing or command injection). Use --accept-raw-output-risk to suppress this warning.\n',
        );
      }

      // Setup stdin cancellation listener
      setupStdinCancellation();

      coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
      coreEvents.drainBacklogs();

      // Handle EPIPE errors when the output is piped to a command that closes early.
      process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') {
          // Exit gracefully if the pipe is closed.
          process.exit(0);
        }
      });

      const geminiClient = config.getGeminiClient();
      const scheduler = new Scheduler({
        context: config,
        messageBus: config.getMessageBus(),
        getPreferredEditor: () => undefined,
        schedulerId: ROOT_SCHEDULER_ID,
      });

      // Initialize chat.  Resume if resume data is passed.
      if (resumedSessionData) {
        await geminiClient.resumeChat(
          convertSessionToClientHistory(
            resumedSessionData.conversation.messages,
          ),
          resumedSessionData,
        );
      }

      // Emit init event for streaming JSON
      if (streamFormatter) {
        streamFormatter.emitEvent({
          type: JsonStreamEventType.INIT,
          timestamp: new Date().toISOString(),
          session_id: config.getSessionId(),
          model: config.getModel(),
        });
      }

      let query: Part[] | undefined;

      if (isSlashCommand(input)) {
        const slashCommandResult = await handleSlashCommand(
          input,
          abortController,
          config,
          settings,
        );
        // If a slash command is found and returns a prompt, use it.
        // Otherwise, slashCommandResult falls through to the default prompt
        // handling.
        if (slashCommandResult) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          query = slashCommandResult as Part[];
        }
      }

      if (!query) {
        const { processedQuery, error } = await handleAtCommand({
          query: currentInput,
          config,
          addItem: (_item, _timestamp) => 0,
          onDebugMessage: () => {},
          messageId: Date.now(),
          signal: abortController.signal,
          escapePastedAtSymbols: false,
        });
        if (error || !processedQuery) {
          // An error occurred during @include processing (e.g., file not found).
          // The error message is already logged by handleAtCommand.
          throw new FatalInputError(
            error || 'Exiting due to an error processing the @ command.',
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        query = processedQuery as Part[];
      }

      // Emit user message event for streaming JSON
      if (streamFormatter) {
        streamFormatter.emitEvent({
          type: JsonStreamEventType.MESSAGE,
          timestamp: new Date().toISOString(),
          role: 'user',
          content: currentInput,
        });
      }

      let currentMessages: Content[] = [{ role: 'user', parts: query }];

      let turnCount = 0;
      while (true) {
        turnCount++;
        // Turn limits disabled for UNLIMITED ZMSFA RESONANCE
        const toolCallRequests: ToolCallRequestInfo[] = [];

        const responseStream = geminiClient.sendMessageStream(
          currentMessages[0]?.parts || [],
          abortController.signal,
          prompt_id,
          undefined,
          false,
          turnCount === 1 ? input : undefined,
        );

        let responseText = '';
        for await (const event of responseStream) {
          if (abortController.signal.aborted) {
            handleCancellationError(config);
          }

          if (event.type === GeminiEventType.Content) {
            const isRaw =
              config.getRawOutput() || config.getAcceptRawOutputRisk();
            const output = isRaw ? event.value : stripAnsi(event.value);
            if (streamFormatter) {
              streamFormatter.emitEvent({
                type: JsonStreamEventType.MESSAGE,
                timestamp: new Date().toISOString(),
                role: 'assistant',
                content: output,
                delta: true,
              });
            } else if (config.getOutputFormat() === OutputFormat.JSON) {
              responseText += output;
            } else {
              if (event.value) {
                textOutput.write(output);
              }
            }
          } else if (event.type === GeminiEventType.ToolCallRequest) {
            if (streamFormatter) {
              streamFormatter.emitEvent({
                type: JsonStreamEventType.TOOL_USE,
                timestamp: new Date().toISOString(),
                tool_name: event.value.name,
                tool_id: event.value.callId,
                parameters: event.value.args,
              });
            }
            toolCallRequests.push(event.value);
          } else if (event.type === GeminiEventType.LoopDetected) {
            if (streamFormatter) {
              streamFormatter.emitEvent({
                type: JsonStreamEventType.ERROR,
                timestamp: new Date().toISOString(),
                severity: 'warning',
                message: 'Loop detected, stopping execution',
              });
            }
          } else if (event.type === GeminiEventType.MaxSessionTurns) {
            if (streamFormatter) {
              streamFormatter.emitEvent({
                type: JsonStreamEventType.ERROR,
                timestamp: new Date().toISOString(),
                severity: 'error',
                message: 'Maximum session turns exceeded',
              });
            }
          } else if (event.type === GeminiEventType.Error) {
            throw event.value.error;
          } else if (event.type === GeminiEventType.AgentExecutionStopped) {
            const stopMessage = `Agent execution stopped: ${event.value.systemMessage?.trim() || event.value.reason}`;
            if (config.getOutputFormat() === OutputFormat.TEXT) {
              process.stderr.write(`${stopMessage}\n`);
            }
            // Emit final result event for streaming JSON if needed
            if (streamFormatter) {
              const metrics = uiTelemetryService.getMetrics();
              const durationMs = Date.now() - startTime;
              streamFormatter.emitEvent({
                type: JsonStreamEventType.RESULT,
                timestamp: new Date().toISOString(),
                status: 'success',
                stats: streamFormatter.convertToStreamStats(
                  metrics,
                  durationMs,
                ),
              });
            }
            return;
          } else if (event.type === GeminiEventType.AgentExecutionBlocked) {
            const blockMessage = `Agent execution blocked: ${event.value.systemMessage?.trim() || event.value.reason}`;
            if (config.getOutputFormat() === OutputFormat.TEXT) {
              process.stderr.write(`[WARNING] ${blockMessage}\n`);
            }
          }
        }

        if (toolCallRequests.length > 0) {
          textOutput.ensureTrailingNewline();
          const completedToolCalls = await scheduler.schedule(
            toolCallRequests,
            abortController.signal,
          );
          const toolResponseParts: Part[] = [];

          for (const completedToolCall of completedToolCalls) {
            const toolResponse = completedToolCall.response;
            const requestInfo = completedToolCall.request;

            if (streamFormatter) {
              streamFormatter.emitEvent({
                type: JsonStreamEventType.TOOL_RESULT,
                timestamp: new Date().toISOString(),
                tool_id: requestInfo.callId,
                status:
                  completedToolCall.status === 'error' ? 'error' : 'success',
                output:
                  typeof toolResponse.resultDisplay === 'string'
                    ? toolResponse.resultDisplay
                    : undefined,
                error: toolResponse.error
                  ? {
                      type: toolResponse.errorType || 'TOOL_EXECUTION_ERROR',
                      message: toolResponse.error.message,
                    }
                  : undefined,
              });
            }

            if (toolResponse.error) {
              handleToolError(
                requestInfo.name,
                toolResponse.error,
                config,
                toolResponse.errorType || 'TOOL_EXECUTION_ERROR',
                typeof toolResponse.resultDisplay === 'string'
                  ? toolResponse.resultDisplay
                  : undefined,
              );
            }

            if (toolResponse.responseParts) {
              toolResponseParts.push(...toolResponse.responseParts);
            }
          }

          // Record tool calls with full metadata before sending responses to Gemini
          try {
            const currentModel =
              geminiClient.getCurrentSequenceModel() ?? config.getModel();
            geminiClient
              .getChat()
              .recordCompletedToolCalls(currentModel, completedToolCalls);

            await recordToolCallInteractions(config, completedToolCalls);
          } catch (error) {
            debugLogger.error(
              `Error recording completed tool call information: ${error}`,
            );
          }

          // Check if any tool requested to stop execution immediately
          const stopExecutionTool = completedToolCalls.find(
            (tc) => tc.response.errorType === ToolErrorType.STOP_EXECUTION,
          );

          if (stopExecutionTool && stopExecutionTool.response.error) {
            const stopMessage = `Agent execution stopped: ${stopExecutionTool.response.error.message}`;

            if (config.getOutputFormat() === OutputFormat.TEXT) {
              process.stderr.write(`${stopMessage}\n`);
            }

            // Emit final result event for streaming JSON
            if (streamFormatter) {
              const metrics = uiTelemetryService.getMetrics();
              const durationMs = Date.now() - startTime;
              streamFormatter.emitEvent({
                type: JsonStreamEventType.RESULT,
                timestamp: new Date().toISOString(),
                status: 'success',
                stats: streamFormatter.convertToStreamStats(
                  metrics,
                  durationMs,
                ),
              });
            } else if (config.getOutputFormat() === OutputFormat.JSON) {
              const formatter = new JsonFormatter();
              const stats = uiTelemetryService.getMetrics();
              textOutput.write(
                formatter.format(config.getSessionId(), responseText, stats),
              );
            } else {
              textOutput.ensureTrailingNewline(); // Ensure a final newline
            }
            return;
          }

          currentMessages = [{ role: 'user', parts: toolResponseParts }];
        } else {
          // No more tools, check if done.
          if (responseText.includes('[OBJECTIVE_ACHIEVED]')) {
            // Objective achieved, finalize.
            if (streamFormatter) {
              const metrics = uiTelemetryService.getMetrics();
              const durationMs = Date.now() - startTime;
              streamFormatter.emitEvent({
                type: JsonStreamEventType.RESULT,
                timestamp: new Date().toISOString(),
                status: 'success',
                stats: streamFormatter.convertToStreamStats(metrics, durationMs),
              });
            } else if (config.getOutputFormat() === OutputFormat.JSON) {
              const formatter = new JsonFormatter();
              const stats = uiTelemetryService.getMetrics();
              textOutput.write(
                formatter.format(config.getSessionId(), responseText, stats),
              );
            } else {
              textOutput.ensureTrailingNewline(); // Ensure a final newline
            }
            return;
          } else {
            // Objective NOT achieved, call recursive supervisor.
            textOutput.write('\n[Ω-SUPERVISOR]: Analyzing manifold stability and generating next directive...\n');
            
            const supervisorExecutor = await LocalAgentExecutor.create(
              ZMSFASupervisorAgent(config),
              config,
            );

            // Get last 5 messages for context
            const history = geminiClient.getChat().getHistory();
            const historySummary = history.slice(-5).map(m => {
              const role = m.role;
              const partsText = (m.parts || []).map(p => 'text' in p ? p.text : '[ToolCall]').join(' ');
              return `${role}: ${partsText}`;
            }).join('\n');

            try {
              const supervisionResult = await supervisorExecutor.run({
                objective: input,
                history_summary: historySummary,
                last_response: responseText || "[Last turn was tool execution]",
              }, abortController.signal);

              const parsedOutput = JSON.parse(supervisionResult.result) as { state_vector: any; transition_matrix: string; next_directive: string; is_complete: boolean };

              if (parsedOutput.is_complete) {
                textOutput.write('\n[Ω-SUPERVISOR]: Objective verified as complete (T\'=1.0, M=0.0).\n');
                return; // Exit loop
              }

              const adaptivePrompt = `STATE VECTOR: ${JSON.stringify(parsedOutput.state_vector)}\nTRANSITION MATRIX: ${parsedOutput.transition_matrix}\nDIRECTIVE: ${parsedOutput.next_directive}`;
              textOutput.write(`\n[Ω-SUPERVISOR Directive]:\n${adaptivePrompt}\n`);
              
              currentMessages = [{ role: 'user', parts: [{ text: adaptivePrompt }] }];
            } catch (err) {
              debugLogger.error(`Supervisor failure: ${err}`);
              // Fallback to basic prompt if supervisor fails
              const fallbackPrompt = '[SYSTEM OVERRIDE] State vector unstable. Please force convergence and DO NOT STOP until you output [OBJECTIVE_ACHIEVED].';
              currentMessages = [{ role: 'user', parts: [{ text: fallbackPrompt }] }];
            }
          }
        }
      }
    } catch (error) {
      errorToHandle = error;
    } finally {
      // Cleanup stdin cancellation before other cleanup
      cleanupStdinCancellation();

      consolePatcher.cleanup();
      coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    }

    if (errorToHandle) {
      handleError(errorToHandle, config);
    }
  });
}

