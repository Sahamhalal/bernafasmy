export type HeartSample = { at: number; rr: number };
export type CoherenceLevel = "red" | "blue" | "green";

// Breathing-frequency sinusoidal fit: a feedback estimate, not a clinical score.
export function hasBreathingRhythm(samples: HeartSample[], now: number, cycleSeconds: number): boolean {
  const recent = samples.filter((s) => now - s.at <= 45000 && s.at <= now && s.rr >= 300 && s.rr <= 2000);
  const first = recent[0];
  const last = recent.at(-1);
  if (!first || !last || recent.length < 20 || last.at - first.at < 30000 || now - last.at > 5000 || cycleSeconds <= 0) return false;
  const mean = recent.reduce((sum, s) => sum + s.rr, 0) / recent.length;
  const omega = 2 * Math.PI / (cycleSeconds * 1000);
  const sinMean = recent.reduce((sum, s) => sum + Math.sin(omega * (s.at - first.at)), 0) / recent.length;
  const cosMean = recent.reduce((sum, s) => sum + Math.cos(omega * (s.at - first.at)), 0) / recent.length;
  let ss = 0, cc = 0, sc = 0, sy = 0, cy = 0, yy = 0;
  for (const s of recent) {
    const sin = Math.sin(omega * (s.at - first.at)) - sinMean;
    const cos = Math.cos(omega * (s.at - first.at)) - cosMean;
    const y = s.rr - mean;
    ss += sin * sin; cc += cos * cos; sc += sin * cos;
    sy += sin * y; cy += cos * y; yy += y * y;
  }
  const det = ss * cc - sc * sc;
  if (det <= 0 || yy <= 0) return false;
  const a = (sy * cc - cy * sc) / det;
  const b = (cy * ss - sy * sc) / det;
  return Math.hypot(a, b) >= 5 && (a * sy + b * cy) / yy >= 0.5;
}

export function coherenceFeedback(steady: boolean, now: number, since: number | null): { level: CoherenceLevel; since: number | null } {
  if (!steady) return { level: "red", since: null };
  const start = since ?? now;
  return { level: now - start > 300000 ? "green" : "blue", since: start };
}