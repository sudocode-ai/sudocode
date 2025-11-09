/**
 * Voice Tools for MCP
 *
 * Enables AI agents to interact with users via voice:
 * - voice_speak: Send text to be spoken via TTS
 * - voice_listen: Retrieve pending voice transcripts from user
 * - voice_status: Check voice availability and queue status
 *
 * @module tools/voice
 */

import type { SudocodeClient } from "../client.js";

export interface VoiceSpeakArgs {
  text: string;
  priority?: "high" | "normal" | "low";
}

export interface VoiceListenArgs {
  // No args needed - returns all pending transcripts
}

export interface VoiceStatusArgs {
  // No args needed - returns voice status
}

/**
 * Voice speak - Send text for text-to-speech output
 *
 * Queues text to be spoken to the user via browser TTS. Text is
 * broadcast to all connected voice clients for the current execution.
 *
 * Priority levels:
 * - high: Interrupts current speech, speaks immediately
 * - normal: Queued after high priority items
 * - low: Queued last, for background/informational messages
 *
 * @example
 * ```typescript
 * await voice_speak(client, {
 *   text: "I've found 3 issues ready to work on.",
 *   priority: "high"
 * });
 * ```
 */
export async function voice_speak(
  client: SudocodeClient,
  args: VoiceSpeakArgs
): Promise<{ success: boolean; message: string }> {
  const { text, priority = "normal" } = args;

  if (!text || text.trim().length === 0) {
    throw new Error("Text is required for voice_speak");
  }

  try {
    // Get execution ID from environment variable set by Claude Code
    const executionId = process.env.SUDOCODE_EXECUTION_ID;

    if (!executionId) {
      return {
        success: false,
        message:
          "No active execution - voice features require an execution context",
      };
    }

    // Call voice speak API
    const response = await fetch(
      `${client.getServerUrl()}/api/voice/speak`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          executionId,
          text,
          priority,
        }),
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || "Failed to queue speech");
    }

    const _data = await response.json();

    return {
      success: true,
      message: `Queued ${text.length} characters for speech (priority: ${priority})`,
    };
  } catch (error) {
    throw new Error(
      `voice_speak failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Voice listen - Retrieve pending voice transcripts from user
 *
 * Returns all voice transcripts that have been queued since the last
 * call to voice_listen. Transcripts are dequeued and returned in
 * chronological order. Each subsequent call returns only new transcripts.
 *
 * Transcript format:
 * - transcript: The text spoken by the user
 * - confidence: Recognition confidence (0-1)
 * - timestamp: When the transcript was captured
 * - isFinal: Whether this is a final or interim transcript
 *
 * @example
 * ```typescript
 * const result = await voice_listen(client, {});
 * if (result.count > 0) {
 *   console.log(`User said: ${result.transcripts[0].transcript}`);
 * }
 * ```
 */
export async function voice_listen(
  client: SudocodeClient,
  _args: VoiceListenArgs
): Promise<{
  success: boolean;
  count: number;
  transcripts: Array<{
    transcript: string;
    confidence: number;
    timestamp: number;
    isFinal: boolean;
  }>;
}> {
  try {
    // Get execution ID from environment variable
    const executionId = process.env.SUDOCODE_EXECUTION_ID;

    if (!executionId) {
      return {
        success: false,
        count: 0,
        transcripts: [],
      };
    }

    // Call voice transcripts API
    const response = await fetch(
      `${client.getServerUrl()}/api/voice/transcripts/${executionId}`
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || "Failed to retrieve transcripts");
    }

    const data = (await response.json()) as { count: number; transcripts: any[] };

    return {
      success: true,
      count: data.count,
      transcripts: data.transcripts || [],
    };
  } catch (error) {
    throw new Error(
      `voice_listen failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Voice status - Check voice availability and queue status
 *
 * Returns information about:
 * - Whether voice is enabled for the current execution
 * - Number of pending transcripts in queue
 * - Whether voice transport is ready
 *
 * Useful for determining if voice features are available before
 * attempting to use them.
 *
 * @example
 * ```typescript
 * const status = await voice_status(client, {});
 * if (status.voiceEnabled) {
 *   await voice_speak(client, { text: "Hello!" });
 * }
 * ```
 */
export async function voice_status(
  client: SudocodeClient,
  _args: VoiceStatusArgs
): Promise<{
  success: boolean;
  voiceEnabled: boolean;
  pendingTranscripts: number;
  transportReady: boolean;
  executionId?: string;
}> {
  try {
    // Get execution ID from environment variable
    const executionId = process.env.SUDOCODE_EXECUTION_ID;

    if (!executionId) {
      return {
        success: false,
        voiceEnabled: false,
        pendingTranscripts: 0,
        transportReady: false,
      };
    }

    // Call voice status API
    const response = await fetch(
      `${client.getServerUrl()}/api/voice/status/${executionId}`
    );

    if (!response.ok) {
      const error = (await response.json()) as { error?: string };
      throw new Error(error.error || "Failed to get voice status");
    }

    const data = (await response.json()) as {
      voiceEnabled?: boolean;
      pendingTranscripts?: number;
      transportReady?: boolean;
    };

    return {
      success: true,
      voiceEnabled: data.voiceEnabled || false,
      pendingTranscripts: data.pendingTranscripts || 0,
      transportReady: data.transportReady || false,
      executionId,
    };
  } catch (error) {
    throw new Error(
      `voice_status failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
