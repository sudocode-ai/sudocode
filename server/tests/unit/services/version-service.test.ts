import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { getVersionInfo } from "../../../src/services/version-service.js";

describe("version-service", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "version-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("getVersionInfo", () => {
    it("should read versions in development (monorepo) structure", () => {
      // Setup monorepo structure:
      // temp/
      //   server/
      //     dist/
      //       services/ <- baseDir
      //     package.json
      //   cli/
      //     package.json
      //   frontend/
      //     package.json

      const serverDir = path.join(tempDir, "server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");
      const cliDir = path.join(tempDir, "cli");
      const frontendDir = path.join(tempDir, "frontend");

      fs.mkdirSync(servicesDir, { recursive: true });
      fs.mkdirSync(cliDir, { recursive: true });
      fs.mkdirSync(frontendDir, { recursive: true });

      // Create package.json files
      fs.writeFileSync(
        path.join(serverDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/local-server", version: "1.0.0" })
      );
      fs.writeFileSync(
        path.join(cliDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/cli", version: "1.0.1" })
      );
      fs.writeFileSync(
        path.join(frontendDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/frontend", version: "1.0.2" })
      );

      const versions = getVersionInfo(servicesDir);

      expect(versions).toEqual({
        cli: "1.0.1",
        server: "1.0.0",
        frontend: "1.0.2",
      });
    });

    it("should read versions in production (global install) structure", () => {
      // Setup global install structure:
      // temp/
      //   @sudocode-ai/
      //     local-server/
      //       dist/
      //         services/ <- baseDir
      //       package.json
      //     cli/
      //       package.json

      const scopeDir = path.join(tempDir, "@sudocode-ai");
      const serverDir = path.join(scopeDir, "local-server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");
      const cliDir = path.join(scopeDir, "cli");

      fs.mkdirSync(servicesDir, { recursive: true });
      fs.mkdirSync(cliDir, { recursive: true });

      // Create package.json files
      fs.writeFileSync(
        path.join(serverDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/local-server", version: "2.0.0" })
      );
      fs.writeFileSync(
        path.join(cliDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/cli", version: "2.0.1" })
      );

      const versions = getVersionInfo(servicesDir);

      expect(versions).toEqual({
        cli: "2.0.1",
        server: "2.0.0",
        frontend: "2.0.0", // Frontend uses server version in production
      });
    });

    it("should read versions in local install (npm install sudocode) structure", () => {
      // Setup local install structure:
      // temp/
      //   node_modules/
      //     sudocode/
      //       node_modules/
      //         @sudocode-ai/
      //           local-server/
      //             dist/
      //               services/ <- baseDir
      //             package.json
      //           cli/
      //             package.json

      const nodeModules = path.join(tempDir, "node_modules", "sudocode", "node_modules");
      const scopeDir = path.join(nodeModules, "@sudocode-ai");
      const serverDir = path.join(scopeDir, "local-server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");
      const cliDir = path.join(scopeDir, "cli");

      fs.mkdirSync(servicesDir, { recursive: true });
      fs.mkdirSync(cliDir, { recursive: true });

      // Create package.json files
      fs.writeFileSync(
        path.join(serverDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/local-server", version: "3.0.0" })
      );
      fs.writeFileSync(
        path.join(cliDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/cli", version: "3.0.1" })
      );

      const versions = getVersionInfo(servicesDir);

      expect(versions).toEqual({
        cli: "3.0.1",
        server: "3.0.0",
        frontend: "3.0.0", // Frontend uses server version in production
      });
    });

    it("should fallback to server version when CLI package not found", () => {
      // Setup structure where CLI is not installed:
      // temp/
      //   @sudocode-ai/
      //     local-server/
      //       dist/
      //         services/ <- baseDir
      //       package.json

      const scopeDir = path.join(tempDir, "@sudocode-ai");
      const serverDir = path.join(scopeDir, "local-server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");

      fs.mkdirSync(servicesDir, { recursive: true });

      // Create only server package.json (no CLI)
      fs.writeFileSync(
        path.join(serverDir, "package.json"),
        JSON.stringify({ name: "@sudocode-ai/local-server", version: "4.0.0" })
      );

      const versions = getVersionInfo(servicesDir);

      expect(versions).toEqual({
        cli: "4.0.0", // Falls back to server version
        server: "4.0.0",
        frontend: "4.0.0",
      });
    });

    it("should throw error if package.json files are invalid JSON", () => {
      // Setup structure with invalid JSON
      const scopeDir = path.join(tempDir, "@sudocode-ai");
      const serverDir = path.join(scopeDir, "local-server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");

      fs.mkdirSync(servicesDir, { recursive: true });

      // Create invalid package.json
      fs.writeFileSync(
        path.join(serverDir, "package.json"),
        "{ invalid json }"
      );

      expect(() => getVersionInfo(servicesDir)).toThrow();
    });

    it("should throw error if server package.json is missing", () => {
      // Setup structure without server package.json
      const scopeDir = path.join(tempDir, "@sudocode-ai");
      const serverDir = path.join(scopeDir, "local-server");
      const distDir = path.join(serverDir, "dist");
      const servicesDir = path.join(distDir, "services");

      fs.mkdirSync(servicesDir, { recursive: true });

      // Don't create any package.json files
      expect(() => getVersionInfo(servicesDir)).toThrow();
    });
  });
});
