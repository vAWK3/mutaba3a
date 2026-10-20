import { describe, expect, it } from "vitest";
import { DEMO_PREFIXES } from "../constants";
import { SeededRandom } from "../prng";

const START = new Date("2025-01-01T00:00:00.000Z");
const END = new Date("2025-12-31T00:00:00.000Z");

describe("SeededRandom", () => {
  it("repeats the same sequence for the same seed", () => {
    const a = new SeededRandom(7);
    const b = new SeededRandom(7);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it("keeps floats in [min, max)", () => {
    const rng = new SeededRandom(1);
    for (let i = 0; i < 200; i++) {
      const value = rng.float(2.5, 3);
      expect(value).toBeGreaterThanOrEqual(2.5);
      expect(value).toBeLessThan(3);
    }
  });

  it("picks distinct items and never more than the array holds", () => {
    const rng = new SeededRandom(2);
    const items = ["a", "b", "c", "d"];
    const two = rng.pickMany(items, 2);
    expect(two).toHaveLength(2);
    expect(new Set(two).size).toBe(2);
    expect([...rng.pickMany(items, 10)].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d"]);
  });

  it("answers chance(0) never and chance(1) always", () => {
    const rng = new SeededRandom(3);
    for (let i = 0; i < 50; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("builds zero-padded demo ids", () => {
    expect(new SeededRandom().demoId("client", 7)).toBe(
      `${DEMO_PREFIXES.client}007`,
    );
  });

  it("keeps dates, date strings and timestamps inside the range", () => {
    const rng = new SeededRandom(4);
    for (let i = 0; i < 50; i++) {
      const timestamp = rng.isoTimestamp(START, END);
      expect(
        timestamp >= START.toISOString() && timestamp <= END.toISOString(),
      ).toBe(true);
      const day = rng.dateString(START, END);
      expect(day).toMatch(/^2025-\d{2}-\d{2}$/);
    }
  });

  it("weightedPick only returns items with weight, and the last item when weights run out", () => {
    const rng = new SeededRandom(5);
    for (let i = 0; i < 100; i++)
      expect(rng.weightedPick(["never", "always"], [0, 1])).toBe("always");
    expect(rng.weightedPick(["x", "y"], [])).toBe("y");
  });

  it("rounds amounts to 50 major units, in minor units", () => {
    const rng = new SeededRandom(6);
    for (let i = 0; i < 50; i++) {
      const minor = rng.amountMinor(100, 5000);
      expect(minor % 5000).toBe(0);
      expect(minor).toBeGreaterThanOrEqual(10000);
      expect(minor).toBeLessThanOrEqual(500000);
    }
  });

  it("formats Israeli mobile numbers and emails from names", () => {
    const rng = new SeededRandom(8);
    expect(rng.phoneNumber()).toMatch(/^05[0-8]-\d{3}-\d{4}$/);
    expect(rng.email("Dana Levi")).toMatch(
      /^dana\.levi@(gmail\.com|outlook\.com|company\.co\.il|business\.com)$/,
    );
  });
});
