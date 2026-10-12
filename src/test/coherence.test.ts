import { describe, expect, it } from "vitest";
import { coherenceFeedback, hasBreathingRhythm } from "@/lib/coherence";

describe("Heart-driven circle feedback", () => {
  it("starts red without steady heart readings", () => {
    expect(coherenceFeedback(false, 0, null)).toEqual({ level: "red", since: null });
  });
  it("turns blue when readings become steady", () => {
    expect(coherenceFeedback(true, 1000, null)).toEqual({ level: "blue", since: 1000 });
  });
  it("requires more than five maintained minutes for green", () => {
    expect(coherenceFeedback(true, 301000, 1000).level).toBe("blue");
    expect(coherenceFeedback(true, 301001, 1000).level).toBe("green");
  });
  it("returns red and restarts the maintained interval when steadiness drops", () => {
    const lost = coherenceFeedback(false, 400000, 1000);
    expect(lost).toEqual({ level: "red", since: null });
    expect(coherenceFeedback(true, 401000, lost.since)).toEqual({ level: "blue", since: 401000 });
  });
  const rhythmic = Array.from({ length: 46 }, (_, i) => ({ at: i * 1000, rr: 850 + 60 * Math.sin(2 * Math.PI * i / 11) }));
  it("detects heart rhythm aligned with the 11-second Coherent pattern", () => {
    expect(hasBreathingRhythm(rhythmic, 45000, 11)).toBe(true);
    expect(hasBreathingRhythm(rhythmic, 45000, 4)).toBe(false);
  });
  it("rejects missing, flat, insufficient or stale readings", () => {
    expect(hasBreathingRhythm([], 45000, 11)).toBe(false);
    expect(hasBreathingRhythm(rhythmic.map((s) => ({ ...s, rr: 850 })), 45000, 11)).toBe(false);
    expect(hasBreathingRhythm(rhythmic.slice(-15), 45000, 11)).toBe(false);
    expect(hasBreathingRhythm(rhythmic, 51000, 11)).toBe(false);
  });
});