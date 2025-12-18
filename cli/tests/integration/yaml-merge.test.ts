/**
 * Integration tests for YAML-based three-way merge
 *
 * Tests the complete pipeline:
 * 1. Group entities by UUID
 * 2. Merge metadata FIRST
 * 3. Apply merged metadata to all versions
 * 4. Convert to YAML
 * 5. Use git merge-file for line-level merging
 * 6. Apply conflict resolver
 * 7. Convert back to JSON
 */

import { describe, it, expect } from 'vitest';
import {
  mergeThreeWay,
  type JSONLEntity,
} from '../../src/merge-resolver.js';

describe('YAML-based three-way merge integration', () => {
  describe('End-to-end merge scenarios', () => {
    it('should handle complex multi-field merge with YAML conversion', () => {
      const base: JSONLEntity[] = [
        {
          id: 'i-abc123',
          uuid: 'uuid-complex-1',
          title: 'Implement Authentication',
          description: 'Add user authentication to the system',
          status: 'open',
          priority: 1,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: ['backend', 'security'],
          relationships: [],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'i-abc123',
          uuid: 'uuid-complex-1',
          title: 'Implement Authentication', // unchanged
          description: 'Add OAuth2 authentication to the system', // modified
          status: 'in_progress', // modified
          priority: 1,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['backend', 'security', 'oauth'], // added tag
          relationships: [
            {
              from: 'i-abc123',
              from_type: 'issue',
              to: 's-auth-spec',
              to_type: 'spec',
              type: 'implements',
            },
          ], // added relationship
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-abc123',
          uuid: 'uuid-complex-1',
          title: 'Implement User Authentication', // modified
          description: 'Add user authentication to the system', // unchanged
          status: 'open',
          priority: 0, // modified
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['backend', 'security', 'critical'], // added tag
          relationships: [
            {
              from: 'i-abc123',
              from_type: 'issue',
              to: 'i-setup-db',
              to_type: 'issue',
              type: 'blocks',
            },
          ], // added different relationship
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // When both sides modify multiple fields, git creates a conflict block
      // The YAML conflict resolver uses latest timestamp (theirs: 2025-01-03)
      // So we get theirs' version for conflicting fields
      expect(result.title).toBe('Implement User Authentication');
      expect(result.description).toBe('Add user authentication to the system');
      expect(result.status).toBe('open');
      expect(result.priority).toBe(0);
      expect(result.updated_at).toBe('2025-01-03T00:00:00Z');

      // Metadata should be merged from all versions
      expect(result.tags).toContain('backend');
      expect(result.tags).toContain('security');
      expect(result.tags).toContain('oauth');
      expect(result.tags).toContain('critical');

      expect(result.relationships).toHaveLength(2);
      expect(result.relationships.some((r: any) => r.to === 's-auth-spec')).toBe(true);
      expect(result.relationships.some((r: any) => r.to === 'i-setup-db')).toBe(true);
    });

    it('should handle multi-line content merge with YAML literal style', () => {
      const base: JSONLEntity[] = [
        {
          id: 's-spec-1',
          uuid: 'uuid-spec-1',
          title: 'API Design',
          description: `# Authentication API

## Endpoints

### POST /auth/login
User login endpoint

### POST /auth/logout
User logout endpoint`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 's-spec-1',
          uuid: 'uuid-spec-1',
          title: 'API Design',
          description: `# Authentication API

## Endpoints

### POST /auth/login
User login endpoint with JWT tokens

### POST /auth/logout
User logout endpoint`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 's-spec-1',
          uuid: 'uuid-spec-1',
          title: 'Authentication API Design',
          description: `# Authentication API

## Endpoints

### POST /auth/login
User login endpoint

### POST /auth/logout
User logout endpoint with session cleanup`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // Title from theirs (most recent)
      expect(result.title).toBe('Authentication API Design');

      // Multi-line content should be merged:
      // - JWT tokens from ours
      // - session cleanup from theirs
      expect(result.description).toContain('JWT tokens');
      expect(result.description).toContain('session cleanup');
    });

    it('should handle concurrent additions with metadata merge', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 'i-new-1',
          uuid: 'uuid-concurrent',
          title: 'Add Redis Cache',
          description: 'Implement Redis caching layer',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['backend', 'performance'],
          relationships: [],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-new-1',
          uuid: 'uuid-concurrent',
          title: 'Add Caching Layer',
          description: 'Implement caching for API responses',
          status: 'in_progress',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['backend', 'optimization'],
          relationships: [
            {
              from: 'i-new-1',
              from_type: 'issue',
              to: 's-cache-spec',
              to_type: 'spec',
              type: 'implements',
            },
          ],
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);

      // Should indicate concurrent addition
      expect(stats.conflicts.some((c) => c.action.includes('Concurrent addition'))).toBe(true);

      const result = merged[0];

      // Most recent wins for conflicting fields
      expect(result.title).toBe('Add Caching Layer');
      expect(result.status).toBe('in_progress');

      // Metadata merged from both
      expect(result.tags).toContain('backend');
      expect(result.tags).toContain('performance');
      expect(result.tags).toContain('optimization');
      expect(result.relationships).toHaveLength(1);
    });

    it('should handle modification-wins-deletion scenarios', () => {
      const base: JSONLEntity[] = [
        {
          id: 'i-obsolete',
          uuid: 'uuid-del-1',
          title: 'Old Feature',
          description: 'This might be obsolete',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'i-legacy',
          uuid: 'uuid-del-2',
          title: 'Legacy Code',
          description: 'Old code to remove',
          status: 'open',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'i-obsolete',
          uuid: 'uuid-del-1',
          title: 'Updated Feature',
          description: 'This is still needed, updated description',
          status: 'in_progress',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
        // i-legacy deleted in ours
      ];

      const theirs: JSONLEntity[] = [
        // i-obsolete deleted in theirs
        {
          id: 'i-legacy',
          uuid: 'uuid-del-2',
          title: 'Refactored Legacy Code',
          description: 'Actually we need this, refactored it',
          status: 'closed',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-04T00:00:00Z',
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

      // Both modifications should win
      expect(merged).toHaveLength(2);

      const obsoleteResult = merged.find((e) => e.uuid === 'uuid-del-1');
      const legacyResult = merged.find((e) => e.uuid === 'uuid-del-2');

      expect(obsoleteResult?.title).toBe('Updated Feature');
      expect(legacyResult?.title).toBe('Refactored Legacy Code');

      // Should have conflict records
      expect(stats.conflicts.some((c) => c.action.includes('Modified in ours, deleted in theirs'))).toBe(true);
      expect(stats.conflicts.some((c) => c.action.includes('Deleted in ours, modified in theirs'))).toBe(true);
    });

    it('should handle multiple entities with mixed operations', () => {
      const base: JSONLEntity[] = [
        {
          id: 'i-base-1',
          uuid: 'uuid-1',
          title: 'Base 1',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
        {
          id: 'i-base-2',
          uuid: 'uuid-2',
          title: 'Base 2',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'i-base-1',
          uuid: 'uuid-1',
          title: 'Modified 1 (ours)',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
        // uuid-2 deleted in ours
        {
          id: 'i-new-ours',
          uuid: 'uuid-3',
          title: 'New in ours',
          created_at: '2025-01-04T00:00:00Z',
          updated_at: '2025-01-04T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        // uuid-1 deleted in theirs
        {
          id: 'i-base-2',
          uuid: 'uuid-2',
          title: 'Modified 2 (theirs)',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-05T00:00:00Z',
        },
        {
          id: 'i-new-theirs',
          uuid: 'uuid-4',
          title: 'New in theirs',
          created_at: '2025-01-06T00:00:00Z',
          updated_at: '2025-01-06T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      // All entities should be present (modifications win deletions)
      expect(merged).toHaveLength(4);

      const ids = merged.map((e) => e.id).sort();
      expect(ids).toEqual(['i-base-1', 'i-base-2', 'i-new-ours', 'i-new-theirs']);

      // Check modifications
      expect(merged.find((e) => e.uuid === 'uuid-1')?.title).toBe('Modified 1 (ours)');
      expect(merged.find((e) => e.uuid === 'uuid-2')?.title).toBe('Modified 2 (theirs)');
    });

    it('should preserve sorting by created_at after complex merge', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 'C',
          uuid: 'uuid-c',
          created_at: '2025-03-01T00:00:00Z',
          updated_at: '2025-03-01T00:00:00Z',
        },
        {
          id: 'A',
          uuid: 'uuid-a',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'D',
          uuid: 'uuid-d',
          created_at: '2025-04-01T00:00:00Z',
          updated_at: '2025-04-01T00:00:00Z',
        },
        {
          id: 'B',
          uuid: 'uuid-b',
          created_at: '2025-02-01T00:00:00Z',
          updated_at: '2025-02-01T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      // Should be sorted by created_at
      expect(merged.map((e) => e.id)).toEqual(['A', 'B', 'C', 'D']);
    });

    /**
     * BUG REPRODUCTION TEST: Newline preservation with long lines
     *
     * This test reproduces the bug described in Test 1.1 of the QA test plan (s-guo4):
     * When merging multi-line descriptions that contain lines longer than 80 characters,
     * newlines are lost because js-yaml switches from literal style (|-) to folded style (>-),
     * causing single newlines to collapse into spaces.
     *
     * Expected: Both changes merged, all newlines preserved
     * Current bug: Lines 3 and 4 in Security Considerations collapse onto one line
     */
    it('should preserve newlines when merging descriptions with long lines', () => {
      // Base spec: Multi-paragraph description with "Security Considerations" section
      const base: JSONLEntity[] = [
        {
          id: 's-test',
          uuid: 'uuid-test',
          description: `# Authentication System

## Overview
The authentication system provides secure user login and session management.

## Security Considerations
All endpoints must use HTTPS in production.
Rate limiting should be applied to prevent brute force attacks.`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      // Branch 1: Modifies Overview section (adds "using OAuth2 and JWT tokens" - creates a line > 80 chars)
      const branch1: JSONLEntity[] = [
        {
          id: 's-test',
          uuid: 'uuid-test',
          description: `# Authentication System

## Overview
The authentication system provides secure user login and session management using OAuth2 and JWT tokens.

## Security Considerations
All endpoints must use HTTPS in production.
Rate limiting should be applied to prevent brute force attacks.`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      // Branch 2: Adds two new lines to Security Considerations section
      const branch2: JSONLEntity[] = [
        {
          id: 's-test',
          uuid: 'uuid-test',
          description: `# Authentication System

## Overview
The authentication system provides secure user login and session management.

## Security Considerations
All endpoints must use HTTPS in production.
Rate limiting should be applied to prevent brute force attacks.
**NEW:** Token expiration should be set to 1 hour.
**NEW:** Refresh tokens should be stored securely.`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, branch1, branch2);
      const result = merged[0];

      // Should have OAuth2 from branch1
      expect(result.description).toContain('OAuth2');

      // Should have both NEW lines from branch2
      expect(result.description).toContain('Token expiration');
      expect(result.description).toContain('Refresh tokens');

      // CRITICAL: Verify newlines are preserved
      // This is the key assertion that will FAIL with the current bug
      const securitySection = result.description.split('## Security Considerations')[1];
      const lines = securitySection.split('\n').filter((l) => l.trim());

      // Should have 4 lines:
      // 1. "All endpoints..."
      // 2. "Rate limiting..."
      // 3. "**NEW:** Token expiration..."
      // 4. "**NEW:** Refresh tokens..."
      expect(lines.length).toBe(4);
      expect(lines[2]).toContain('Token expiration');
      expect(lines[3]).toContain('Refresh tokens');

      // Additional verification: the two NEW lines should be on separate lines, not collapsed
      // BUG: Currently they collapse into: "Rate limiting... **NEW:** Token expiration... **NEW:** Refresh tokens..."
      const collapsedPattern = /Rate limiting.*Token expiration.*Refresh tokens/;
      expect(result.description).not.toMatch(collapsedPattern);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle empty arrays gracefully', () => {
      const { entities: merged } = mergeThreeWay([], [], []);

      expect(merged).toHaveLength(0);
    });

    it('should handle entities with missing optional fields', () => {
      const base: JSONLEntity[] = [
        {
          id: 'i-minimal',
          uuid: 'uuid-min',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'i-minimal',
          uuid: 'uuid-min',
          title: 'Added title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-minimal',
          uuid: 'uuid-min',
          description: 'Added description',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      // Latest timestamp wins (theirs: 2025-01-03)
      expect(merged[0].title).toBeUndefined(); // theirs didn't have title
      expect(merged[0].description).toBe('Added description');
      expect(merged[0].updated_at).toBe('2025-01-03T00:00:00Z');
    });

    it('should handle entities with only metadata differences', () => {
      const base: JSONLEntity[] = [
        {
          id: 'i-meta',
          uuid: 'uuid-meta',
          title: 'Same Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
          tags: [],
        },
      ];

      const ours: JSONLEntity[] = [
        {
          id: 'i-meta',
          uuid: 'uuid-meta',
          title: 'Same Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['tag-from-ours'],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-meta',
          uuid: 'uuid-meta',
          title: 'Same Title',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['tag-from-theirs'],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(merged[0].tags).toContain('tag-from-ours');
      expect(merged[0].tags).toContain('tag-from-theirs');
    });
  });

  describe('Simulated 3-way merge (empty base)', () => {
    it('should treat concurrent additions as conflicts and merge them', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 'i-new',
          uuid: 'uuid-new',
          title: 'New Feature (ours)',
          description: 'Added by ours',
          status: 'open',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['ours-tag'],
          relationships: [],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-new',
          uuid: 'uuid-new',
          title: 'New Feature (theirs)',
          description: 'Added by theirs',
          status: 'in_progress',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['theirs-tag'],
          relationships: [],
        },
      ];

      const { entities: merged, stats } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);
      expect(stats.conflicts.some((c) => c.action.includes('Concurrent addition'))).toBe(true);

      const result = merged[0];

      // Latest timestamp wins (theirs: 2025-01-03)
      expect(result.title).toBe('New Feature (theirs)');
      expect(result.status).toBe('in_progress');

      // Metadata merged from both
      expect(result.tags).toContain('ours-tag');
      expect(result.tags).toContain('theirs-tag');
    });

    it('should handle one-sided additions correctly', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 'i-ours-only',
          uuid: 'uuid-ours',
          title: 'Added by ours',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-01T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-theirs-only',
          uuid: 'uuid-theirs',
          title: 'Added by theirs',
          created_at: '2025-01-02T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(2);
      expect(merged.find((e) => e.uuid === 'uuid-ours')?.title).toBe('Added by ours');
      expect(merged.find((e) => e.uuid === 'uuid-theirs')?.title).toBe('Added by theirs');
    });

    it('should merge multi-line descriptions with YAML line-level merging', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 's-doc',
          uuid: 'uuid-doc',
          title: 'Documentation',
          description: `Line 1: Added by ours
Line 2: Common
Line 3: Added by ours`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 's-doc',
          uuid: 'uuid-doc',
          title: 'Documentation',
          description: `Line 1: Common
Line 2: Common
Line 3: Added by theirs`,
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);

      // YAML merge should combine non-conflicting lines
      const result = merged[0];
      expect(result.description).toBeTruthy();
    });

    it('should union metadata even in simulated 3-way', () => {
      const base: JSONLEntity[] = [];

      const ours: JSONLEntity[] = [
        {
          id: 'i-meta',
          uuid: 'uuid-meta',
          title: 'Feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-02T00:00:00Z',
          tags: ['backend', 'ours-specific'],
          relationships: [
            {
              from: 'i-meta',
              from_type: 'issue',
              to: 's-ours',
              to_type: 'spec',
              type: 'implements',
            },
          ],
        },
      ];

      const theirs: JSONLEntity[] = [
        {
          id: 'i-meta',
          uuid: 'uuid-meta',
          title: 'Feature',
          created_at: '2025-01-01T00:00:00Z',
          updated_at: '2025-01-03T00:00:00Z',
          tags: ['backend', 'theirs-specific'],
          relationships: [
            {
              from: 'i-meta',
              from_type: 'issue',
              to: 'i-theirs',
              to_type: 'issue',
              type: 'blocks',
            },
          ],
        },
      ];

      const { entities: merged } = mergeThreeWay(base, ours, theirs);

      expect(merged).toHaveLength(1);

      const result = merged[0];

      // All tags should be present
      expect(result.tags).toHaveLength(3);
      expect(result.tags).toContain('backend');
      expect(result.tags).toContain('ours-specific');
      expect(result.tags).toContain('theirs-specific');

      // All relationships should be present
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships.some((r: any) => r.to === 's-ours')).toBe(true);
      expect(result.relationships.some((r: any) => r.to === 'i-theirs')).toBe(true);
    });
  });
});
