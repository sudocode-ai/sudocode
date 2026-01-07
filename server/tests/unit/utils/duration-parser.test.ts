/**
 * Unit tests for duration parser utility
 */

import { describe, it, expect } from "vitest";
import { parseKeepAliveDuration } from "../../../src/utils/duration-parser.js";

describe("parseKeepAliveDuration", () => {
  describe("valid formats", () => {
    it("should parse 72h correctly", () => {
      expect(parseKeepAliveDuration("72h")).toBe(72);
    });

    it("should parse 168h correctly", () => {
      expect(parseKeepAliveDuration("168h")).toBe(168);
    });

    it("should parse 1h correctly", () => {
      expect(parseKeepAliveDuration("1h")).toBe(1);
    });

    it("should parse 24h correctly", () => {
      expect(parseKeepAliveDuration("24h")).toBe(24);
    });

    it("should parse large durations correctly", () => {
      expect(parseKeepAliveDuration("720h")).toBe(720);
    });
  });

  describe("invalid formats", () => {
    it("should throw on invalid format without h suffix", () => {
      expect(() => parseKeepAliveDuration("72")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on invalid format with wrong suffix", () => {
      expect(() => parseKeepAliveDuration("72m")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on invalid format with letters", () => {
      expect(() => parseKeepAliveDuration("abc")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on empty string", () => {
      expect(() => parseKeepAliveDuration("")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on format with spaces", () => {
      expect(() => parseKeepAliveDuration("72 h")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on negative duration", () => {
      expect(() => parseKeepAliveDuration("-72h")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });

    it("should throw on decimal duration", () => {
      expect(() => parseKeepAliveDuration("72.5h")).toThrow(
        "Invalid duration format. Use format like \"72h\" or \"168h\""
      );
    });
  });
});
