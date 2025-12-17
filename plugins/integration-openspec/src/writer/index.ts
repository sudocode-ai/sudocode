/**
 * Writer module for OpenSpec Integration
 *
 * Provides utilities for writing updates back to OpenSpec files
 * during bidirectional synchronization.
 */

export {
  updateAllTasksCompletion,
  updateTaskByLine,
  updateTaskByDescription,
} from "./tasks-writer.js";

export { updateSpecContent, updateSpecTitle } from "./spec-writer.js";
