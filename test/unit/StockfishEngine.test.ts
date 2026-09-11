import { describe, it, expect } from "vitest";
import { StockfishEngine } from "../../src/services/chess/StockfishEngine";

describe("StockfishEngine.isAvailable", () => {
  it("reports true when the real binary is reachable", async () => {
    const available = await StockfishEngine.isAvailable();
    expect(available).toBe(true);
  }, 10000);

  it("reports false (not a throw) when the binary path is invalid", async () => {
    const originalPath = process.env.STOCKFISH_PATH;
    process.env.STOCKFISH_PATH = "/nonexistent/binary";
    try {
      const available = await StockfishEngine.isAvailable();
      expect(available).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.STOCKFISH_PATH;
      else process.env.STOCKFISH_PATH = originalPath;
    }
  }, 10000);
});
