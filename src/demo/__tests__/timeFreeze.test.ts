import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_FROZEN_TIME } from "../constants";
import {
  FREEZE_PRESETS,
  freezeTime,
  freezeToPreset,
  getDemoNow,
  getDemoToday,
  getFrozenTime,
  isTimeFrozen,
  unfreezeTime,
} from "../timeFreeze";

describe("demo time freeze", () => {
  afterEach(() => {
    unfreezeTime();
  });

  it("runs on real time until frozen", () => {
    expect(isTimeFrozen()).toBe(false);
    expect(getFrozenTime()).toBeNull();
    const before = Date.now();
    expect(getDemoNow().getTime()).toBeGreaterThanOrEqual(before);
  });

  it("freezes to the given instant, and today follows it", () => {
    freezeTime("2025-03-31T23:30:00.000Z");
    expect(isTimeFrozen()).toBe(true);
    expect(getFrozenTime()).toBe("2025-03-31T23:30:00.000Z");
    expect(getDemoNow().toISOString()).toBe("2025-03-31T23:30:00.000Z");
    expect(getDemoToday()).toBe("2025-03-31");
  });

  it("freezes to the default screenshot time when no date is given", () => {
    freezeTime();
    expect(getFrozenTime()).toBe(DEFAULT_FROZEN_TIME);
  });

  it("freezes to a named preset", () => {
    freezeToPreset("endOfMonth");
    expect(getFrozenTime()).toBe(FREEZE_PRESETS.endOfMonth);
    expect(getDemoToday()).toBe("2025-01-28");
  });

  it("returns to real time when unfrozen", () => {
    freezeToPreset("midYear");
    unfreezeTime();
    expect(isTimeFrozen()).toBe(false);
    expect(getDemoNow().getFullYear()).toBe(new Date().getFullYear());
  });
});
