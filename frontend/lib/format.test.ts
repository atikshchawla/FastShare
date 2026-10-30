import { describe, expect, it } from "vitest";
import { formatBytes, formatSeconds } from "./format";

describe("formatBytes", () => {
  it("handles the edge cases", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("scales through every unit with sane precision", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.0 GB");
    // >= 100 drops the decimal
    expect(formatBytes(100 * 1024)).toBe("100 KB");
    // huge values clamp at GB (no unit creep beyond the list)
    expect(formatBytes(1024 ** 4)).toContain("GB");
  });
});

describe("formatSeconds", () => {
  it("formats mm:ss and clamps negatives", () => {
    expect(formatSeconds(0)).toBe("00:00");
    expect(formatSeconds(9)).toBe("00:09");
    expect(formatSeconds(75)).toBe("01:15");
    expect(formatSeconds(600)).toBe("10:00");
    expect(formatSeconds(-3)).toBe("00:00");
  });
});
