/**
 * Manual test for SpecAnalyzer
 * Run with: node --loader ts-node/esm spec-analyzer.test-manual.ts
 * Or: node spec-analyzer.test-manual.js (after compilation)
 */

// Simple test runner
function runTests() {
  console.log("🧪 Testing SpecAnalyzer...\n");

  const tests = [
    testCompleteSpec,
    testIncompleteSpec,
    testAmbiguousLanguage,
    testMissingCriteria,
    testCodeExamples,
  ];

  let passed = 0;
  let failed = 0;

  tests.forEach((test) => {
    try {
      test();
      console.log(`✅ ${test.name} PASSED`);
      passed++;
    } catch (error) {
      console.log(`❌ ${test.name} FAILED`);
      console.error(`   Error: ${error.message}\n`);
      failed++;
    }
  });

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

// Mock SpecAnalyzer class for testing
class SpecAnalyzer {
  analyzeSpec(specId, content, title) {
    const issues = [];
    const suggestions = [];
    const missingSections = [];
    const strengths = [];

    // Check required sections
    const requiredSections = ["Overview", "Requirements", "Implementation", "Testing", "Success Criteria"];
    requiredSections.forEach((section) => {
      const regex = new RegExp(`^#{1,3}\\s*${section}\\s*$`, "mi");
      if (!regex.test(content)) {
        missingSections.push(section);
      }
    });

    if (missingSections.length > 0) {
      issues.push({
        type: "missing_section",
        severity: "critical",
        message: `Missing required sections: ${missingSections.join(", ")}`,
      });
    } else {
      strengths.push("Contains all required sections");
    }

    // Check for ambiguous language
    const ambiguousPatterns = [
      /\b(should|could|may|might|possibly|probably)\b/gi,
      /\b(soon|later|eventually|sometime)\b/gi,
      /\b(some|few|many|several)\b/gi,
      /\b(fast|slow|big|small|simple)\b/gi,
    ];

    let ambiguousCount = 0;
    ambiguousPatterns.forEach((pattern) => {
      const matches = content.match(pattern);
      if (matches) {
        ambiguousCount += matches.length;
      }
    });

    if (ambiguousCount > 5) {
      issues.push({
        type: "ambiguous_language",
        severity: "warning",
        message: `Found ${ambiguousCount} instances of ambiguous language`,
      });
    } else if (ambiguousCount === 0) {
      strengths.push("Uses clear, specific language");
    }

    // Check word count
    const wordCount = content.split(/\s+/).length;
    if (wordCount < 100) {
      issues.push({
        type: "incomplete",
        severity: "critical",
        message: "Spec is very short",
      });
    } else if (wordCount > 200) {
      strengths.push("Contains detailed information");
    }

    // Check for code examples
    if (/```/.test(content)) {
      strengths.push("Includes code examples");
    }

    // Check for acceptance criteria
    const successCriteriaSection = content.match(
      /#{1,3}\s*(Success Criteria|Acceptance Criteria)(.*?)(?=#{1,3}|$)/is
    );

    let hasAcceptanceCriteria = false;
    if (successCriteriaSection) {
      const sectionContent = successCriteriaSection[2];
      const hasBullets = /^[\s]*[-*]\s+.+/m.test(sectionContent);
      const hasNumbers = /^[\s]*\d+\.\s+.+/m.test(sectionContent);
      hasAcceptanceCriteria = hasBullets || hasNumbers;
    }

    if (!hasAcceptanceCriteria) {
      issues.push({
        type: "missing_section",
        severity: "warning",
        message: "No clear acceptance criteria found",
      });
    } else {
      strengths.push("Has clear acceptance criteria");
    }

    // Calculate score
    let score = 100;
    issues.forEach((issue) => {
      if (issue.severity === "critical") score -= 20;
      else if (issue.severity === "warning") score -= 10;
    });
    if (wordCount < 100) score -= 30;
    else if (wordCount < 200) score -= 15;
    score += Math.min(strengths.length * 5, 20);
    score = Math.max(0, Math.min(100, score));

    return {
      specId,
      overallScore: score,
      issues,
      suggestions,
      missingSections,
      strengths,
    };
  }

  generateFeedback(analysis) {
    const feedback = [];

    analysis.issues.forEach((issue) => {
      if (issue.severity === "critical") {
        feedback.push({
          category: "blocker",
          content: issue.message,
        });
      }
    });

    return feedback;
  }
}

// Test cases
function testCompleteSpec() {
  const analyzer = new SpecAnalyzer();
  const spec = `
# Complete Spec

## Overview
This is a complete spec.

## Requirements
- Requirement 1: Response time under 200ms
- Requirement 2: Handle 1000 users

## Implementation
Implementation details here.

\`\`\`typescript
interface Config {
  timeout: number;
}
\`\`\`

## Testing
Test plan here.

## Success Criteria
- All requirements met
- Tests pass
  `;

  const result = analyzer.analyzeSpec("spec_complete", spec, "Complete");

  if (result.overallScore < 70) {
    throw new Error(`Expected score > 70, got ${result.overallScore}`);
  }

  if (result.missingSections.length > 0) {
    throw new Error(`Expected no missing sections, got ${result.missingSections.length}`);
  }

  if (result.strengths.length === 0) {
    throw new Error("Expected at least one strength");
  }
}

function testIncompleteSpec() {
  const analyzer = new SpecAnalyzer();
  const spec = `
# Incomplete

## Overview
Just an overview.
  `;

  const result = analyzer.analyzeSpec("spec_incomplete", spec, "Incomplete");

  if (result.overallScore >= 50) {
    throw new Error(`Expected score < 50, got ${result.overallScore}`);
  }

  if (result.missingSections.length === 0) {
    throw new Error("Expected missing sections");
  }

  const criticalIssue = result.issues.find((i) => i.severity === "critical");
  if (!criticalIssue) {
    throw new Error("Expected at least one critical issue");
  }
}

function testAmbiguousLanguage() {
  const analyzer = new SpecAnalyzer();
  const spec = `
# Ambiguous Spec

## Overview
The system should probably work fast and handle some requests maybe.

## Requirements
- Users might want this
- Performance could be important
- We should add features soon

## Implementation
Later.

## Testing
A few tests.

## Success Criteria
- Works
  `;

  const result = analyzer.analyzeSpec("spec_ambiguous", spec, "Ambiguous");

  const ambiguousIssue = result.issues.find((i) => i.type === "ambiguous_language");
  if (!ambiguousIssue) {
    throw new Error("Expected ambiguous language issue");
  }
}

function testMissingCriteria() {
  const analyzer = new SpecAnalyzer();
  const spec = `
# No Criteria

## Overview
Overview here.

## Requirements
- Req 1
- Req 2

## Implementation
Implementation.

## Testing
Testing.

## Success Criteria
It works.
  `;

  const result = analyzer.analyzeSpec("spec_no_criteria", spec, "No Criteria");

  const criteriaIssue = result.issues.find((i) =>
    i.message.toLowerCase().includes("acceptance criteria")
  );
  if (!criteriaIssue) {
    throw new Error("Expected missing criteria issue");
  }
}

function testCodeExamples() {
  const analyzer = new SpecAnalyzer();
  const spec = `
# Code Example Spec

## Overview
Spec with code.

## Requirements
- API endpoints

## Implementation
\`\`\`typescript
app.get('/api', (req, res) => res.json({}));
\`\`\`

## Testing
Test it.

## Success Criteria
- Returns 200
- Valid JSON
  `;

  const result = analyzer.analyzeSpec("spec_code", spec, "Code");

  if (!result.strengths.includes("Includes code examples")) {
    throw new Error("Expected code examples to be recognized as strength");
  }
}

// Run all tests
const success = runTests();
process.exit(success ? 0 : 1);
