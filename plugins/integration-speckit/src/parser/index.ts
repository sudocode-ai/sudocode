/**
 * Spec-Kit Parsers
 *
 * Exports all parsers for spec-kit markdown files.
 */

// Markdown utilities
export {
  PATTERNS,
  extractMetadata,
  extractTitle,
  extractTitleWithPrefixRemoval,
  extractMetadataValue,
  extractCrossReferences,
  findContentStartIndex,
  extractSection,
  parseDate,
  escapeRegex,
  cleanTaskDescription,
  normalizeStatus,
} from "./markdown-utils.js";

// Spec parser
export {
  parseSpec,
  parseSpecContent,
  isSpecFile,
  getSpecFileTitle,
  getSpecFileStatus,
  type ParsedSpecKitSpec,
  type ParseSpecOptions,
} from "./spec-parser.js";

// Plan parser
export {
  parsePlan,
  parsePlanContent,
  isPlanFile,
  getPlanFileTitle,
  getPlanFileStatus,
  type ParsedSpecKitPlan,
  type ParsePlanOptions,
} from "./plan-parser.js";

// Tasks parser
export {
  parseTasks,
  parseTasksContent,
  getAllTasks,
  getTaskById,
  getIncompleteTasks,
  getParallelizableTasks,
  getTasksByPhase,
  getTasksByUserStory,
  isTasksFile,
  getTaskStats,
  type ParsedTask,
  type ParsedTasksFile,
  type ParseTasksOptions,
} from "./tasks-parser.js";

// Supporting documents parser
export {
  parseResearch,
  parseDataModel,
  parseSupportingDoc,
  parseContract,
  parseContractsDirectory,
  discoverSupportingDocs,
  detectDocType,
  type SupportingDocType,
  type ParsedSupportingDoc,
  type ParsedContract,
  type ParseSupportingDocOptions,
} from "./supporting-docs.js";
