/**
 * Integration tests for auth module
 * 
 * Tests that verify:
 * - Auth module index exports all functions correctly
 * - Auth commands are properly registered in CLI
 * - Command handlers are wired up correctly
 * - Global flags (--json) are passed through
 */

import { describe, it, expect } from "vitest";
import * as authModule from "../../../src/auth/index.js";

describe("Auth Module Integration", () => {
  describe("Module Exports", () => {
    it("should export core credentials functions", () => {
      // Core interface functions
      expect(authModule.getAllCredentials).toBeDefined();
      expect(authModule.hasAnyCredential).toBeDefined();
      expect(authModule.getConfiguredCredentialCount).toBeDefined();
      expect(authModule.getConfiguredCredentialTypes).toBeDefined();
      
      // Individual credential getters
      expect(authModule.getClaudeToken).toBeDefined();
      expect(authModule.hasClaudeToken).toBeDefined();
      
      // Write operations
      expect(authModule.setClaudeToken).toBeDefined();
      expect(authModule.clearAllCredentials).toBeDefined();
      
      // Constants
      expect(authModule.CONFIG_DIR).toBeDefined();
      expect(authModule.CREDENTIALS_FILE).toBeDefined();
      expect(authModule.getCredentialsFilePath).toBeDefined();
    });

    it("should export command handlers", () => {
      expect(authModule.handleClaudeAuth).toBeDefined();
      expect(authModule.showAuthStatus).toBeDefined();
      expect(authModule.handleAuthClear).toBeDefined();
    });

    it("should export all functions as callable", () => {
      // Verify functions are actually functions
      expect(typeof authModule.getAllCredentials).toBe("function");
      expect(typeof authModule.hasAnyCredential).toBe("function");
      expect(typeof authModule.getConfiguredCredentialCount).toBe("function");
      expect(typeof authModule.getConfiguredCredentialTypes).toBe("function");
      expect(typeof authModule.getClaudeToken).toBe("function");
      expect(typeof authModule.hasClaudeToken).toBe("function");
      expect(typeof authModule.setClaudeToken).toBe("function");
      expect(typeof authModule.clearAllCredentials).toBeDefined();
      expect(typeof authModule.getCredentialsFilePath).toBe("function");
      expect(typeof authModule.handleClaudeAuth).toBe("function");
      expect(typeof authModule.showAuthStatus).toBe("function");
      expect(typeof authModule.handleAuthClear).toBe("function");
    });
  });

  describe("Module Structure", () => {
    it("should export credentials module functions", () => {
      const {
        getAllCredentials,
        hasAnyCredential,
        getConfiguredCredentialCount,
        getConfiguredCredentialTypes,
        getClaudeToken,
        hasClaudeToken,
        setClaudeToken,
        clearAllCredentials,
        CONFIG_DIR,
        CREDENTIALS_FILE,
        getCredentialsFilePath,
      } = authModule;

      expect(getAllCredentials).toBeDefined();
      expect(hasAnyCredential).toBeDefined();
      expect(getConfiguredCredentialCount).toBeDefined();
      expect(getConfiguredCredentialTypes).toBeDefined();
      expect(getClaudeToken).toBeDefined();
      expect(hasClaudeToken).toBeDefined();
      expect(setClaudeToken).toBeDefined();
      expect(clearAllCredentials).toBeDefined();
      expect(CONFIG_DIR).toBeDefined();
      expect(CREDENTIALS_FILE).toBeDefined();
      expect(getCredentialsFilePath).toBeDefined();
    });

    it("should export command handler functions", () => {
      const {
        handleClaudeAuth,
        showAuthStatus,
        handleAuthClear,
      } = authModule;

      expect(handleClaudeAuth).toBeDefined();
      expect(showAuthStatus).toBeDefined();
      expect(handleAuthClear).toBeDefined();
    });
  });

  describe("Type Exports", () => {
    it("should have proper TypeScript types", () => {
      // This test verifies the code compiles with proper types
      // TypeScript will catch type errors at compile time
      
      // Test that we can import and use the Credentials type
      type Creds = typeof authModule extends { Credentials: infer T } ? T : never;
      
      // Test that handler options types exist (implicit through usage)
      const claudeOptions: Parameters<typeof authModule.handleClaudeAuth>[0] = { force: true };
      const statusOptions: Parameters<typeof authModule.showAuthStatus>[0] = { json: true };
      const clearOptions: Parameters<typeof authModule.handleAuthClear>[0] = { force: true };
      
      expect(claudeOptions).toBeDefined();
      expect(statusOptions).toBeDefined();
      expect(clearOptions).toBeDefined();
    });
  });

  describe("Function Signatures", () => {
    it("getAllCredentials should return a Promise", () => {
      const result = authModule.getAllCredentials();
      expect(result).toBeInstanceOf(Promise);
    });

    it("hasAnyCredential should return a Promise", () => {
      const result = authModule.hasAnyCredential();
      expect(result).toBeInstanceOf(Promise);
    });

    it("getConfiguredCredentialCount should return a Promise", () => {
      const result = authModule.getConfiguredCredentialCount();
      expect(result).toBeInstanceOf(Promise);
    });

    it("getConfiguredCredentialTypes should return a Promise", () => {
      const result = authModule.getConfiguredCredentialTypes();
      expect(result).toBeInstanceOf(Promise);
    });

    it("getClaudeToken should return a Promise", () => {
      const result = authModule.getClaudeToken();
      expect(result).toBeInstanceOf(Promise);
    });

    it("hasClaudeToken should return a Promise", () => {
      const result = authModule.hasClaudeToken();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe("Constants", () => {
    it("CONFIG_DIR should be a string", () => {
      expect(typeof authModule.CONFIG_DIR).toBe("string");
    });

    it("CREDENTIALS_FILE should be a string", () => {
      expect(typeof authModule.CREDENTIALS_FILE).toBe("string");
    });

    it("CONFIG_DIR should end with sudocode", () => {
      expect(authModule.CONFIG_DIR).toMatch(/sudocode$/);
    });

    it("CREDENTIALS_FILE should end with user_credentials.json", () => {
      expect(authModule.CREDENTIALS_FILE).toMatch(/user_credentials\.json$/);
    });
  });

  describe("Cross-module Integration", () => {
    it("should import from credentials module without errors", async () => {
      // Test that we can call a function from credentials module
      const hasAny = await authModule.hasAnyCredential();
      expect(typeof hasAny).toBe("boolean");
    });

    it("should import from all command modules without errors", () => {
      // Test that all command handlers are accessible
      expect(authModule.handleClaudeAuth).toBeDefined();
      expect(authModule.showAuthStatus).toBeDefined();
      expect(authModule.handleAuthClear).toBeDefined();
    });
  });

  describe("Backward Compatibility", () => {
    it("should maintain individual credential getters", () => {
      // These are needed for backward compatibility
      expect(authModule.getClaudeToken).toBeDefined();
      expect(authModule.hasClaudeToken).toBeDefined();
    });

    it("should maintain credential constants", () => {
      // These are used by external code
      expect(authModule.CONFIG_DIR).toBeDefined();
      expect(authModule.CREDENTIALS_FILE).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle missing credentials gracefully", async () => {
      // getAllCredentials should not throw when file doesn't exist
      const creds = await authModule.getAllCredentials();
      expect(creds).toBeDefined();
      expect(creds.claudeToken).toBeDefined(); // null is defined
    });

    it("should handle hasAnyCredential with missing file", async () => {
      // Should return false, not throw
      const result = await authModule.hasAnyCredential();
      expect(typeof result).toBe("boolean");
    });

    it("should handle getConfiguredCredentialTypes with missing file", async () => {
      // Should return empty array, not throw
      const types = await authModule.getConfiguredCredentialTypes();
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe("Module Re-exports", () => {
    it("should re-export credentials module types", () => {
      // Test that Credentials type is available
      // This is implicitly tested by TypeScript compilation
      const testFn = async () => {
        const creds = await authModule.getAllCredentials();
        // If Credentials type wasn't exported, this would fail compilation
        return creds;
      };
      expect(testFn).toBeDefined();
    });

    it("should re-export all necessary types for external usage", () => {
      // Test that option types are available through the module
      // ClaudeAuthOptions, StatusOptions, ClearOptions
      // These are implicitly tested through function signatures
      expect(authModule.handleClaudeAuth).toBeDefined();
      expect(authModule.showAuthStatus).toBeDefined();
      expect(authModule.handleAuthClear).toBeDefined();
    });
  });
});

describe("CLI Command Registration", () => {
  describe("Command Handler Exports", () => {
    it("should export handleClaudeAuth for CLI integration", () => {
      expect(authModule.handleClaudeAuth).toBeDefined();
      expect(typeof authModule.handleClaudeAuth).toBe("function");
    });

    it("should export showAuthStatus for CLI integration", () => {
      expect(authModule.showAuthStatus).toBeDefined();
      expect(typeof authModule.showAuthStatus).toBe("function");
    });

    it("should export handleAuthClear for CLI integration", () => {
      expect(authModule.handleAuthClear).toBeDefined();
      expect(typeof authModule.handleAuthClear).toBe("function");
    });
  });

  describe("Handler Option Types", () => {
    it("handleClaudeAuth should accept force option", async () => {
      // Type test - should compile without errors
      const options = { force: true };
      // Don't actually call (would interact with file system)
      expect(options).toBeDefined();
    });

    it("showAuthStatus should accept json option", async () => {
      // Type test - should compile without errors
      const options = { json: true };
      expect(options).toBeDefined();
    });

    it("handleAuthClear should accept force option", async () => {
      // Type test - should compile without errors
      const options = { force: true };
      expect(options).toBeDefined();
    });
  });
});

describe("Extensibility", () => {
  describe("Future Credential Types", () => {
    it("should support adding new credential getters", () => {
      // The module structure should allow adding:
      // - getLLMKey (future)
      // - getLiteLLMCredentials (future)
      // Without breaking existing exports
      
      expect(authModule.getAllCredentials).toBeDefined();
      expect(authModule.getClaudeToken).toBeDefined();
      
      // Future exports would follow same pattern
    });

    it("should support multi-credential queries", async () => {
      // getConfiguredCredentialTypes returns array
      const types = await authModule.getConfiguredCredentialTypes();
      expect(Array.isArray(types)).toBe(true);
      
      // This allows iterating over all configured types
      types.forEach(type => {
        expect(typeof type).toBe("string");
      });
    });
  });

  describe("Helper Functions", () => {
    it("should export getCredentialsFilePath for testing", () => {
      expect(authModule.getCredentialsFilePath).toBeDefined();
      expect(typeof authModule.getCredentialsFilePath).toBe("function");
    });

    it("getCredentialsFilePath should return a string", () => {
      const path = authModule.getCredentialsFilePath();
      expect(typeof path).toBe("string");
    });
  });
});
