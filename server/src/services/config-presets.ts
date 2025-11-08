/**
 * Configuration Presets Service
 * Phase 6: Predefined config modes for different autonomy levels
 */

import type { ProjectAgentConfig } from "@sudocode-ai/types";

export type ConfigPreset = "conservative" | "balanced" | "aggressive";

export interface PresetDescription {
  name: string;
  description: string;
  use_cases: string[];
  config: ProjectAgentConfig;
}

/**
 * Configuration Presets
 * Each preset defines a complete ProjectAgentConfig with different autonomy levels
 */
export const CONFIG_PRESETS: Record<ConfigPreset, PresetDescription> = {
  /**
   * Conservative Mode
   * - Requires manual approval for all actions
   * - Monitoring enabled but no automatic actions
   * - Best for critical projects or first-time users
   */
  conservative: {
    name: "Conservative",
    description: "Requires manual approval for all actions. Agent only monitors and suggests.",
    use_cases: [
      "Critical production projects",
      "First-time project agent users",
      "High-stakes development",
      "Strict change control requirements",
    ],
    config: {
      useWorktree: true,
      worktreePath: ".sudocode/worktrees/project-agent",
      mode: "monitoring",
      autoApprove: {
        enabled: false, // No auto-approval at all
        allowedActions: [],
        minConfidenceScore: 100, // Impossible threshold
        maxRiskLevel: "low",
      },
      monitoring: {
        stallThresholdMinutes: 30,
        checkIntervalSeconds: 60,
      },
    },
  },

  /**
   * Balanced Mode (Default)
   * - Auto-approves low-risk actions (feedback, relationships)
   * - Requires approval for executions and spec modifications
   * - Best for most use cases
   */
  balanced: {
    name: "Balanced",
    description: "Auto-approves low-risk actions. Requires approval for executions and modifications.",
    use_cases: [
      "Most development projects",
      "Teams familiar with project agent",
      "General-purpose development",
      "Balance between automation and control",
    ],
    config: {
      useWorktree: true,
      worktreePath: ".sudocode/worktrees/project-agent",
      mode: "full",
      autoApprove: {
        enabled: true,
        allowedActions: [
          "add_feedback",
          "create_relationship",
          "create_issues_from_spec",
        ],
        minConfidenceScore: 70, // Medium-high confidence required
        maxRiskLevel: "medium", // Accept low and medium risk
      },
      monitoring: {
        stallThresholdMinutes: 30,
        checkIntervalSeconds: 60,
      },
    },
  },

  /**
   * Aggressive Mode
   * - Auto-approves most actions except critical modifications
   * - High autonomy with only spec modifications requiring approval
   * - Best for experimental projects or rapid prototyping
   */
  aggressive: {
    name: "Aggressive",
    description: "Highly autonomous. Auto-approves most actions including starting executions.",
    use_cases: [
      "Experimental projects",
      "Rapid prototyping",
      "Solo developers with high trust in agent",
      "Non-critical side projects",
    ],
    config: {
      useWorktree: true,
      worktreePath: ".sudocode/worktrees/project-agent",
      mode: "full",
      autoApprove: {
        enabled: true,
        allowedActions: [
          "add_feedback",
          "create_relationship",
          "create_issues_from_spec",
          "start_execution",
          "pause_execution",
          "resume_execution",
          "update_issue_status",
          // Note: modify_spec is NOT in the list - always requires approval
        ],
        minConfidenceScore: 60, // Lower threshold for faster action
        maxRiskLevel: "high", // Accept all risk levels except modify_spec
      },
      monitoring: {
        stallThresholdMinutes: 20, // More aggressive stall detection
        checkIntervalSeconds: 30, // More frequent checks
      },
    },
  },
};

/**
 * Get config for a preset
 */
export function getPresetConfig(preset: ConfigPreset): ProjectAgentConfig {
  return CONFIG_PRESETS[preset].config;
}

/**
 * Get all available presets with descriptions
 */
export function getAvailablePresets(): Array<{
  id: ConfigPreset;
  name: string;
  description: string;
  use_cases: string[];
}> {
  return Object.entries(CONFIG_PRESETS).map(([id, preset]) => ({
    id: id as ConfigPreset,
    name: preset.name,
    description: preset.description,
    use_cases: preset.use_cases,
  }));
}

/**
 * Validate a config and suggest appropriate preset
 */
export function suggestPreset(config: ProjectAgentConfig): {
  suggested: ConfigPreset;
  reason: string;
  confidence: number; // 0-100
} {
  const { autoApprove } = config;

  // If auto-approve disabled, definitely conservative
  if (!autoApprove.enabled) {
    return {
      suggested: "conservative",
      reason: "Auto-approval is disabled",
      confidence: 100,
    };
  }

  const allowedCount = autoApprove.allowedActions.length;
  const minConfidence = autoApprove.minConfidenceScore ?? 70;
  const maxRisk = autoApprove.maxRiskLevel ?? "medium";

  // Conservative: no auto-approve or very restrictive
  if (allowedCount === 0 || (minConfidence >= 90 && maxRisk === "low")) {
    return {
      suggested: "conservative",
      reason: "Very restrictive auto-approval settings",
      confidence: 85,
    };
  }

  // Aggressive: many actions allowed, low thresholds
  if (
    allowedCount >= 6 &&
    minConfidence <= 65 &&
    (maxRisk === "medium" || maxRisk === "high")
  ) {
    return {
      suggested: "aggressive",
      reason: "Many actions auto-approved with low thresholds",
      confidence: 85,
    };
  }

  // Balanced: moderate settings
  return {
    suggested: "balanced",
    reason: "Moderate auto-approval settings",
    confidence: 70,
  };
}

/**
 * Merge custom settings with a preset
 */
export function mergeWithPreset(
  preset: ConfigPreset,
  overrides: Partial<ProjectAgentConfig>
): ProjectAgentConfig {
  const baseConfig = getPresetConfig(preset);

  return {
    ...baseConfig,
    ...overrides,
    autoApprove: {
      ...baseConfig.autoApprove,
      ...(overrides.autoApprove || {}),
    },
    monitoring: {
      ...baseConfig.monitoring,
      ...(overrides.monitoring || {}),
    },
  };
}

/**
 * Get preset comparison matrix
 */
export function getPresetComparison(): Array<{
  feature: string;
  conservative: string;
  balanced: string;
  aggressive: string;
}> {
  return [
    {
      feature: "Auto-approve feedback",
      conservative: "❌ No",
      balanced: "✅ Yes",
      aggressive: "✅ Yes",
    },
    {
      feature: "Auto-create issues",
      conservative: "❌ No",
      balanced: "✅ Yes (high confidence)",
      aggressive: "✅ Yes (medium confidence)",
    },
    {
      feature: "Auto-start executions",
      conservative: "❌ No",
      balanced: "❌ Requires approval",
      aggressive: "✅ Yes",
    },
    {
      feature: "Auto-pause stalled executions",
      conservative: "❌ No",
      balanced: "❌ Requires approval",
      aggressive: "✅ Yes",
    },
    {
      feature: "Auto-modify specs",
      conservative: "❌ No",
      balanced: "❌ Requires approval",
      aggressive: "❌ Always requires approval",
    },
    {
      feature: "Confidence threshold",
      conservative: "N/A",
      balanced: "70%",
      aggressive: "60%",
    },
    {
      feature: "Max risk level",
      conservative: "N/A",
      balanced: "Medium",
      aggressive: "High",
    },
    {
      feature: "Stall detection",
      conservative: "30 min",
      balanced: "30 min",
      aggressive: "20 min",
    },
    {
      feature: "Check interval",
      conservative: "60 sec",
      balanced: "60 sec",
      aggressive: "30 sec",
    },
  ];
}
