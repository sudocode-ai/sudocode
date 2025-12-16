/**
 * Writers for Spec-Kit Integration
 *
 * Provides outbound sync capabilities (sudocode → spec-kit)
 */

// Tasks writer
export {
  updateTaskStatus,
  getTaskStatus,
  getAllTaskStatuses,
  type TaskUpdateResult,
} from "./tasks-writer.js";

// Spec writer
export {
  updateSpecContent,
  getSpecTitle,
  getSpecStatus,
  type SpecUpdates,
  type SpecUpdateResult,
} from "./spec-writer.js";
