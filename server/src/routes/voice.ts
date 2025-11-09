/**
 * Voice API Routes
 *
 * REST API endpoints for voice interaction with executions.
 * These endpoints are used by the MCP server to enable voice-controlled
 * AI conversations.
 *
 * @module routes/voice
 */

import { Router, Request, Response } from "express";
import type { TransportManager } from "../execution/transport/transport-manager.js";
import type { VoiceTranscriptQueue } from "../services/voice-transcript-queue.js";
import type { VoiceEvent } from "@sudocode-ai/types";

export interface VoiceRouterDependencies {
  transportManager: TransportManager;
  transcriptQueue: VoiceTranscriptQueue;
}

/**
 * Create voice API router
 */
export function createVoiceRouter(deps: VoiceRouterDependencies): Router {
  const router = Router();
  const { transportManager, transcriptQueue } = deps;

  /**
   * POST /api/voice/speak
   *
   * Queue text for text-to-speech on an execution
   *
   * Body: {
   *   executionId: string,
   *   text: string,
   *   priority?: "high" | "normal" | "low"
   * }
   */
  router.post("/speak", (req: Request, res: Response) => {
    try {
      const { executionId, text, priority = "normal" } = req.body;

      if (!executionId || !text) {
        res.status(400).json({
          error: "Missing required fields: executionId, text",
        });
        return;
      }

      // Create voice output event
      const event: VoiceEvent = {
        type: "output",
        data: {
          text,
          priority: priority as "high" | "normal" | "low",
          timestamp: Date.now(),
        },
      };

      // Broadcast to voice transport
      transportManager.broadcastVoiceEvent(executionId, event);

      res.status(200).json({
        success: true,
        executionId,
        text: text.substring(0, 100),
        priority,
      });
    } catch (error) {
      console.error("[voice-api] Error in /speak:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  /**
   * GET /api/voice/transcripts/:executionId
   *
   * Get and dequeue all pending voice transcripts for an execution
   */
  router.get("/transcripts/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        res.status(400).json({ error: "Missing executionId" });
        return;
      }

      const transcripts = transcriptQueue.dequeue(executionId);

      res.status(200).json({
        success: true,
        executionId,
        count: transcripts.length,
        transcripts,
      });
    } catch (error) {
      console.error("[voice-api] Error in /transcripts:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  /**
   * GET /api/voice/peek/:executionId
   *
   * Peek at pending transcripts without removing them
   */
  router.get("/peek/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        res.status(400).json({ error: "Missing executionId" });
        return;
      }

      const transcripts = transcriptQueue.peek(executionId);

      res.status(200).json({
        success: true,
        executionId,
        count: transcripts.length,
        transcripts,
      });
    } catch (error) {
      console.error("[voice-api] Error in /peek:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  /**
   * DELETE /api/voice/transcripts/:executionId
   *
   * Clear all pending transcripts for an execution
   */
  router.delete("/transcripts/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        res.status(400).json({ error: "Missing executionId" });
        return;
      }

      transcriptQueue.clear(executionId);

      res.status(200).json({
        success: true,
        executionId,
        message: "Transcripts cleared",
      });
    } catch (error) {
      console.error("[voice-api] Error in DELETE /transcripts:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  /**
   * GET /api/voice/status/:executionId
   *
   * Get voice status and configuration for an execution
   */
  router.get("/status/:executionId", (req: Request, res: Response) => {
    try {
      const { executionId } = req.params;

      if (!executionId) {
        res.status(400).json({ error: "Missing executionId" });
        return;
      }

      const voiceTransport = transportManager.getVoiceTransport();
      const hasVoiceAdapter = transportManager["voiceAdapters"]?.has(executionId);
      const pendingCount = transcriptQueue.count(executionId);

      res.status(200).json({
        success: true,
        executionId,
        voiceEnabled: hasVoiceAdapter,
        pendingTranscripts: pendingCount,
        transportReady: !!voiceTransport,
      });
    } catch (error) {
      console.error("[voice-api] Error in /status:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  /**
   * GET /api/voice/stats
   *
   * Get overall voice queue statistics (debugging)
   */
  router.get("/stats", (_req: Request, res: Response) => {
    try {
      const stats = transcriptQueue.getStats();

      res.status(200).json({
        success: true,
        ...stats,
      });
    } catch (error) {
      console.error("[voice-api] Error in /stats:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

  return router;
}
