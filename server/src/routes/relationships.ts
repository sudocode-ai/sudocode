/**
 * Relationships API routes (mapped to /api/relationships)
 */

import { Router, Request, Response } from "express";
import type Database from "better-sqlite3";
import type { EntityType, RelationshipType } from "@sudocode/types";
import {
  createRelationship,
  deleteRelationship,
  getEntityRelationships,
  getEntityOutgoingRelationships,
  getEntityIncomingRelationships,
} from "../services/relationships.js";
import { broadcastRelationshipUpdate } from "../services/websocket.js";

export function createRelationshipsRouter(db: Database.Database): Router {
  const router = Router();

  /**
   * GET /api/relationships/:entity_type/:entity_id - Get all relationships for an entity
   */
  router.get("/:entity_type/:entity_id", (req: Request, res: Response) => {
    try {
      const { entity_type, entity_id } = req.params;

      // Validate entity_type
      if (entity_type !== "spec" && entity_type !== "issue") {
        res.status(400).json({
          success: false,
          data: null,
          message: "Invalid entity_type. Must be 'spec' or 'issue'",
        });
        return;
      }

      const relationships = getEntityRelationships(
        db,
        entity_id,
        entity_type as EntityType
      );

      res.json({
        success: true,
        data: relationships,
      });
    } catch (error) {
      console.error("Error getting relationships:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to get relationships",
      });
    }
  });

  /**
   * GET /api/relationships/:entity_type/:entity_id/outgoing - Get outgoing relationships
   */
  router.get(
    "/:entity_type/:entity_id/outgoing",
    (req: Request, res: Response) => {
      try {
        const { entity_type, entity_id } = req.params;
        const { relationship_type } = req.query;

        // Validate entity_type
        if (entity_type !== "spec" && entity_type !== "issue") {
          res.status(400).json({
            success: false,
            data: null,
            message: "Invalid entity_type. Must be 'spec' or 'issue'",
          });
          return;
        }

        const relationships = getEntityOutgoingRelationships(
          db,
          entity_id,
          entity_type as EntityType,
          relationship_type as RelationshipType | undefined
        );

        res.json({
          success: true,
          data: relationships,
        });
      } catch (error) {
        console.error("Error getting outgoing relationships:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get outgoing relationships",
        });
      }
    }
  );

  /**
   * GET /api/relationships/:entity_type/:entity_id/incoming - Get incoming relationships
   */
  router.get(
    "/:entity_type/:entity_id/incoming",
    (req: Request, res: Response) => {
      try {
        const { entity_type, entity_id } = req.params;
        const { relationship_type } = req.query;

        // Validate entity_type
        if (entity_type !== "spec" && entity_type !== "issue") {
          res.status(400).json({
            success: false,
            data: null,
            message: "Invalid entity_type. Must be 'spec' or 'issue'",
          });
          return;
        }

        const relationships = getEntityIncomingRelationships(
          db,
          entity_id,
          entity_type as EntityType,
          relationship_type as RelationshipType | undefined
        );

        res.json({
          success: true,
          data: relationships,
        });
      } catch (error) {
        console.error("Error getting incoming relationships:", error);
        res.status(500).json({
          success: false,
          data: null,
          error_data: error instanceof Error ? error.message : String(error),
          message: "Failed to get incoming relationships",
        });
      }
    }
  );

  /**
   * POST /api/relationships - Create a new relationship
   */
  router.post("/", (req: Request, res: Response) => {
    try {
      const { from_id, from_type, to_id, to_type, relationship_type, metadata } =
        req.body;

      // Validate required fields
      if (!from_id || typeof from_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "from_id is required and must be a string",
        });
        return;
      }

      if (!from_type || (from_type !== "spec" && from_type !== "issue")) {
        res.status(400).json({
          success: false,
          data: null,
          message: "from_type is required and must be 'spec' or 'issue'",
        });
        return;
      }

      if (!to_id || typeof to_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "to_id is required and must be a string",
        });
        return;
      }

      if (!to_type || (to_type !== "spec" && to_type !== "issue")) {
        res.status(400).json({
          success: false,
          data: null,
          message: "to_type is required and must be 'spec' or 'issue'",
        });
        return;
      }

      if (!relationship_type || typeof relationship_type !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "relationship_type is required and must be a string",
        });
        return;
      }

      // Validate relationship_type
      const validTypes = [
        "blocks",
        "related",
        "discovered-from",
        "implements",
        "references",
        "depends-on",
      ];
      if (!validTypes.includes(relationship_type)) {
        res.status(400).json({
          success: false,
          data: null,
          message: `Invalid relationship_type. Must be one of: ${validTypes.join(", ")}`,
        });
        return;
      }

      // Create relationship using CLI operation
      const relationship = createRelationship(db, {
        from_id,
        from_type: from_type as EntityType,
        to_id,
        to_type: to_type as EntityType,
        relationship_type: relationship_type as RelationshipType,
        metadata: metadata || null,
      });

      // Broadcast relationship creation to WebSocket clients
      broadcastRelationshipUpdate("created", relationship);

      res.status(201).json({
        success: true,
        data: relationship,
      });
    } catch (error) {
      console.error("Error creating relationship:", error);

      // Handle specific errors
      if (error instanceof Error) {
        if (error.message.includes("not found")) {
          res.status(404).json({
            success: false,
            data: null,
            message: error.message,
          });
          return;
        }

        if (error.message.includes("already exists")) {
          res.status(409).json({
            success: false,
            data: null,
            message: error.message,
          });
          return;
        }
      }

      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to create relationship",
      });
    }
  });

  /**
   * DELETE /api/relationships - Delete a specific relationship
   */
  router.delete("/", (req: Request, res: Response) => {
    try {
      const { from_id, from_type, to_id, to_type, relationship_type } =
        req.body;

      // Validate required fields
      if (!from_id || typeof from_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "from_id is required and must be a string",
        });
        return;
      }

      if (!from_type || (from_type !== "spec" && from_type !== "issue")) {
        res.status(400).json({
          success: false,
          data: null,
          message: "from_type is required and must be 'spec' or 'issue'",
        });
        return;
      }

      if (!to_id || typeof to_id !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "to_id is required and must be a string",
        });
        return;
      }

      if (!to_type || (to_type !== "spec" && to_type !== "issue")) {
        res.status(400).json({
          success: false,
          data: null,
          message: "to_type is required and must be 'spec' or 'issue'",
        });
        return;
      }

      if (!relationship_type || typeof relationship_type !== "string") {
        res.status(400).json({
          success: false,
          data: null,
          message: "relationship_type is required and must be a string",
        });
        return;
      }

      // Delete relationship using CLI operation
      const deleted = deleteRelationship(
        db,
        from_id,
        from_type as EntityType,
        to_id,
        to_type as EntityType,
        relationship_type as RelationshipType
      );

      if (deleted) {
        // Broadcast relationship deletion to WebSocket clients
        broadcastRelationshipUpdate("deleted", {
          from_id,
          from_type,
          to_id,
          to_type,
          relationship_type,
        });

        res.json({
          success: true,
          data: {
            from_id,
            from_type,
            to_id,
            to_type,
            relationship_type,
            deleted: true,
          },
        });
      } else {
        res.status(404).json({
          success: false,
          data: null,
          message: "Relationship not found",
        });
      }
    } catch (error) {
      console.error("Error deleting relationship:", error);
      res.status(500).json({
        success: false,
        data: null,
        error_data: error instanceof Error ? error.message : String(error),
        message: "Failed to delete relationship",
      });
    }
  });

  return router;
}
