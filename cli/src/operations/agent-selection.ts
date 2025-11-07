/**
 * Dynamic agent selection based on issue type and context
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPreset } from "@sudocode-ai/types";
import { listAgentPresets } from "./agents.js";

export interface SelectionRule {
  id: string;
  priority: number; // Higher priority rules are checked first

  // Conditions
  conditions: {
    issue_type?: string[];
    tags?: string[];
    priority?: number[];
    status?: string[];
    title_contains?: string[];
    description_contains?: string[];
    custom_expression?: string; // JavaScript expression
  };

  // Agent selection
  agent_id: string;
  workflow_id?: string; // Optional: use workflow instead of single agent

  // Metadata
  description?: string;
  enabled: boolean;
}

export interface SelectionConfig {
  version: string;
  rules: SelectionRule[];
  default_agent?: string;
  default_workflow?: string;

  // Fallback behavior
  fallback_to_manual: boolean;

  created_at: string;
  updated_at: string;
}

export interface SelectionContext {
  issue_id: string;
  title: string;
  description?: string;
  type?: string;
  tags?: string[];
  priority?: number;
  status?: string;

  // Additional context
  file_patterns?: string[];
  spec_id?: string;
  relationships?: Array<{
    type: string;
    to_id: string;
  }>;

  // Custom metadata
  metadata?: Record<string, any>;
}

export interface SelectionResult {
  matched: boolean;
  agent_id?: string;
  workflow_id?: string;
  rule_id?: string;
  confidence: number; // 0-1 score
  reason: string;
  alternatives?: Array<{
    agent_id?: string;
    workflow_id?: string;
    confidence: number;
  }>;
}

/**
 * Initialize selection config
 */
export function initializeSelectionConfig(sudocodeDir: string): SelectionConfig {
  const configPath = getSelectionConfigPath(sudocodeDir);

  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  }

  // Create default config with common rules
  const config: SelectionConfig = {
    version: "1.0.0",
    rules: [
      {
        id: "review-rule",
        priority: 10,
        conditions: {
          issue_type: ["review"],
          tags: ["review", "quality"],
        },
        agent_id: "code-reviewer",
        description: "Use code reviewer for review issues",
        enabled: true,
      },
      {
        id: "test-rule",
        priority: 9,
        conditions: {
          issue_type: ["test", "testing"],
          tags: ["test", "testing", "qa"],
        },
        agent_id: "test-writer",
        description: "Use test writer for testing issues",
        enabled: true,
      },
      {
        id: "refactor-rule",
        priority: 8,
        conditions: {
          issue_type: ["refactor"],
          tags: ["refactor", "cleanup", "tech-debt"],
        },
        agent_id: "refactorer",
        description: "Use refactorer for refactoring issues",
        enabled: true,
      },
      {
        id: "docs-rule",
        priority: 7,
        conditions: {
          issue_type: ["documentation", "docs"],
          tags: ["documentation", "docs"],
        },
        agent_id: "documenter",
        description: "Use documenter for documentation issues",
        enabled: true,
      },
    ],
    fallback_to_manual: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  saveSelectionConfig(sudocodeDir, config);
  return config;
}

/**
 * Get selection config path
 */
function getSelectionConfigPath(sudocodeDir: string): string {
  return path.join(sudocodeDir, "agents", "selection.config.json");
}

/**
 * Save selection config
 */
export function saveSelectionConfig(
  sudocodeDir: string,
  config: SelectionConfig
): void {
  const configPath = getSelectionConfigPath(sudocodeDir);
  const dir = path.dirname(configPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  config.updated_at = new Date().toISOString();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Select agent based on context
 */
export function selectAgent(
  sudocodeDir: string,
  context: SelectionContext
): SelectionResult {
  const config = initializeSelectionConfig(sudocodeDir);

  // Sort rules by priority (highest first)
  const sortedRules = [...config.rules]
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  // Try to match each rule
  for (const rule of sortedRules) {
    const match = matchRule(rule, context);
    if (match.matched) {
      return {
        matched: true,
        agent_id: rule.agent_id,
        workflow_id: rule.workflow_id,
        rule_id: rule.id,
        confidence: match.confidence,
        reason: `Matched rule: ${rule.description || rule.id}`,
        alternatives: findAlternatives(sudocodeDir, context, rule.id),
      };
    }
  }

  // No rule matched, use default or fallback
  if (config.default_agent || config.default_workflow) {
    return {
      matched: true,
      agent_id: config.default_agent,
      workflow_id: config.default_workflow,
      confidence: 0.5,
      reason: "Using default agent/workflow",
    };
  }

  return {
    matched: false,
    confidence: 0,
    reason: "No matching rule found",
  };
}

/**
 * Match rule against context
 */
function matchRule(
  rule: SelectionRule,
  context: SelectionContext
): { matched: boolean; confidence: number } {
  let matches = 0;
  let conditions = 0;

  // Check issue type
  if (rule.conditions.issue_type && context.type) {
    conditions++;
    if (rule.conditions.issue_type.includes(context.type)) {
      matches++;
    }
  }

  // Check tags
  if (rule.conditions.tags && context.tags) {
    conditions++;
    const hasMatchingTag = rule.conditions.tags.some((tag) =>
      context.tags?.includes(tag)
    );
    if (hasMatchingTag) {
      matches++;
    }
  }

  // Check priority
  if (rule.conditions.priority && context.priority !== undefined) {
    conditions++;
    if (rule.conditions.priority.includes(context.priority)) {
      matches++;
    }
  }

  // Check status
  if (rule.conditions.status && context.status) {
    conditions++;
    if (rule.conditions.status.includes(context.status)) {
      matches++;
    }
  }

  // Check title contains
  if (rule.conditions.title_contains && context.title) {
    conditions++;
    const titleLower = context.title.toLowerCase();
    const hasMatch = rule.conditions.title_contains.some((phrase) =>
      titleLower.includes(phrase.toLowerCase())
    );
    if (hasMatch) {
      matches++;
    }
  }

  // Check description contains
  if (rule.conditions.description_contains && context.description) {
    conditions++;
    const descLower = context.description.toLowerCase();
    const hasMatch = rule.conditions.description_contains.some((phrase) =>
      descLower.includes(phrase.toLowerCase())
    );
    if (hasMatch) {
      matches++;
    }
  }

  // Custom expression evaluation (advanced)
  if (rule.conditions.custom_expression) {
    conditions++;
    try {
      // Create safe eval context
      const evalContext = { context, rule };
      const result = evaluateExpression(
        rule.conditions.custom_expression,
        evalContext
      );
      if (result) {
        matches++;
      }
    } catch (error) {
      // Ignore expression errors
    }
  }

  // Calculate confidence based on matches
  if (conditions === 0) {
    return { matched: false, confidence: 0 };
  }

  const confidence = matches / conditions;
  const matched = confidence >= 0.5; // At least 50% of conditions must match

  return { matched, confidence };
}

/**
 * Evaluate custom expression safely
 */
function evaluateExpression(expression: string, context: any): boolean {
  // This is a simplified evaluation - in production, use a safe sandbox
  // For now, we'll just do basic pattern matching
  try {
    // Simple variable replacement
    let evalExpr = expression;

    // Replace context.field with actual values
    evalExpr = evalExpr.replace(
      /context\.(\w+)/g,
      (_, field) => JSON.stringify(context.context[field])
    );

    // For safety, only allow basic comparisons
    const safePattern = /^["'\w\s.]+\s*(===|!==|==|!=|>|<|>=|<=)\s*["'\w\s.]+$/;
    if (!safePattern.test(evalExpr)) {
      return false;
    }

    return eval(evalExpr);
  } catch {
    return false;
  }
}

/**
 * Find alternative agents
 */
function findAlternatives(
  sudocodeDir: string,
  context: SelectionContext,
  excludeRuleId: string
): Array<{ agent_id?: string; confidence: number }> {
  const config = initializeSelectionConfig(sudocodeDir);
  const alternatives: Array<{ agent_id?: string; confidence: number }> = [];

  for (const rule of config.rules) {
    if (rule.id === excludeRuleId || !rule.enabled) {
      continue;
    }

    const match = matchRule(rule, context);
    if (match.matched && match.confidence > 0.3) {
      alternatives.push({
        agent_id: rule.agent_id,
        confidence: match.confidence,
      });
    }
  }

  return alternatives.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

/**
 * Add selection rule
 */
export function addSelectionRule(
  sudocodeDir: string,
  rule: Omit<SelectionRule, "id">
): SelectionRule {
  const config = initializeSelectionConfig(sudocodeDir);

  const newRule: SelectionRule = {
    ...rule,
    id: `rule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  };

  config.rules.push(newRule);
  saveSelectionConfig(sudocodeDir, config);

  return newRule;
}

/**
 * Remove selection rule
 */
export function removeSelectionRule(
  sudocodeDir: string,
  ruleId: string
): boolean {
  const config = initializeSelectionConfig(sudocodeDir);
  const index = config.rules.findIndex((r) => r.id === ruleId);

  if (index === -1) {
    return false;
  }

  config.rules.splice(index, 1);
  saveSelectionConfig(sudocodeDir, config);

  return true;
}

/**
 * Update selection rule
 */
export function updateSelectionRule(
  sudocodeDir: string,
  ruleId: string,
  updates: Partial<Omit<SelectionRule, "id">>
): SelectionRule | null {
  const config = initializeSelectionConfig(sudocodeDir);
  const rule = config.rules.find((r) => r.id === ruleId);

  if (!rule) {
    return null;
  }

  Object.assign(rule, updates);
  saveSelectionConfig(sudocodeDir, config);

  return rule;
}

/**
 * Get agent recommendations based on context
 */
export function getAgentRecommendations(
  sudocodeDir: string,
  context: SelectionContext
): Array<{
  agent_id: string;
  confidence: number;
  reason: string;
  agent: AgentPreset;
}> {
  const config = initializeSelectionConfig(sudocodeDir);
  const recommendations: Array<{
    agent_id: string;
    confidence: number;
    reason: string;
    agent: AgentPreset;
  }> = [];

  const agents = listAgentPresets(sudocodeDir);
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  // Check all rules
  for (const rule of config.rules) {
    if (!rule.enabled) continue;

    const match = matchRule(rule, context);
    if (match.confidence > 0.2) {
      // At least 20% confidence
      const agent = agentMap.get(rule.agent_id);
      if (agent) {
        recommendations.push({
          agent_id: rule.agent_id,
          confidence: match.confidence,
          reason: rule.description || `Matched ${Math.round(match.confidence * 100)}% of conditions`,
          agent,
        });
      }
    }
  }

  return recommendations.sort((a, b) => b.confidence - a.confidence);
}
