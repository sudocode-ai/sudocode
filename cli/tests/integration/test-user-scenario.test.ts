/**
 * Test for the exact user scenario described:
 * - Create base with spec and issue
 * - Branch 1: Modify different line in description, change status to in_progress
 * - Branch 2: Modify different line in description, keep status unchanged
 * Expected: Both line changes merge cleanly, status becomes in_progress
 */

import { describe, it, expect } from 'vitest';
import { mergeThreeWay } from '../../src/merge-resolver.js';
import type { IssueJSONL, SpecJSONL } from '../../src/types.js';

describe('User Scenario: Different line changes + status change', () => {
  it('should merge different line changes and preserve status change from one branch', () => {
    // BASE: spec and issue with multi-line description
    const baseSpec: SpecJSONL = {
      id: 's-test',
      uuid: 'uuid-spec',
      title: 'Test Spec',
      file_path: '.sudocode/specs/test.md',
      content: 'Line 1 original\nLine 2 original\nLine 3 original',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      relationships: [],
      tags: [],
    };

    const baseIssue: IssueJSONL = {
      id: 'i-test',
      uuid: 'uuid-issue',
      title: 'Test Issue',
      content: 'Line 1 original\nLine 2 original\nLine 3 original',
      status: 'open',
      priority: 1,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      relationships: [],
      tags: [],
    };

    // BRANCH 1: Modify line 1 of each, change status to in_progress
    const branch1Spec: SpecJSONL = {
      ...baseSpec,
      content: 'Line 1 BRANCH1\nLine 2 original\nLine 3 original',
      updated_at: '2025-01-02T00:00:00Z',
    };

    const branch1Issue: IssueJSONL = {
      ...baseIssue,
      content: 'Line 1 BRANCH1\nLine 2 original\nLine 3 original',
      status: 'in_progress', // CHANGED
      updated_at: '2025-01-02T00:00:00Z',
    };

    // BRANCH 2: Modify line 3 of each, leave status unchanged
    const branch2Spec: SpecJSONL = {
      ...baseSpec,
      content: 'Line 1 original\nLine 2 original\nLine 3 BRANCH2',
      updated_at: '2025-01-03T00:00:00Z', // Newer timestamp
    };

    const branch2Issue: IssueJSONL = {
      ...baseIssue,
      content: 'Line 1 original\nLine 2 original\nLine 3 BRANCH2',
      status: 'open', // UNCHANGED
      updated_at: '2025-01-03T00:00:00Z', // Newer timestamp
    };

    // MERGE
    const specResult = mergeThreeWay([baseSpec], [branch1Spec], [branch2Spec]);
    const issueResult = mergeThreeWay([baseIssue], [branch1Issue], [branch2Issue]);

    console.log('\n=== SPEC MERGE RESULT ===');
    console.log('Content:', specResult.entities[0].content);
    console.log('Stats:', JSON.stringify(specResult.stats, null, 2));

    console.log('\n=== ISSUE MERGE RESULT ===');
    console.log('Content:', issueResult.entities[0].content);
    console.log('Status:', issueResult.entities[0].status);
    console.log('Updated at:', issueResult.entities[0].updated_at);
    console.log('Stats:', JSON.stringify(issueResult.stats, null, 2));

    // EXPECTATIONS FOR SPEC
    expect(specResult.entities).toHaveLength(1);
    expect(specResult.entities[0].content).toContain('Line 1 BRANCH1');
    expect(specResult.entities[0].content).toContain('Line 3 BRANCH2');

    // EXPECTATIONS FOR ISSUE
    expect(issueResult.entities).toHaveLength(1);

    // 1. Line changes from both branches should be preserved
    expect(issueResult.entities[0].content).toContain('Line 1 BRANCH1');
    expect(issueResult.entities[0].content).toContain('Line 3 BRANCH2');

    // 2. Status should be in_progress (only branch1 changed it)
    // This is the KEY assertion that should pass with proper three-way merge
    expect(issueResult.entities[0].status).toBe('in_progress');
  });
});
