import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { coherenceFeedback, hasBreathingRhythm, type HeartSample, type CoherenceLevel } from "@/lib/coherence";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tide — Paced Breathing with Heart Rate & HRV" },
      { name: "description", content: "Custom inhale, hold, exhale, hold breathing timer synced with live BPM and HRV from your heart rate monitor." },
      { property: "og:title", content: "Tide — Paced Breathing with Heart Rate & HRV" },
      { property: "og:description", content: "Custom breathing timer with live BPM and HRV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Fraunces:wght@400;600&family=Manrope:wght@400;600&display=swap" },
    ],
  }),
  component: Index,
});

type PhaseKey = "inhale" | "hold1" | "exhale" | "hold2";
const PHASES: { key: PhaseKey; label: string }[] = [
  { key: "inhale", label: "Inhale" },
  { key: "hold1", label: "Pause" },
  { key: "exhale", label: "Exhale" },
  { key: "hold2", label: "Pause" },
];
type Timing = Record<PhaseKey, number>;
const PRESETS = {
  Box: { inhale: 4, hold1: 4, exhale: 4, hold2: 4 },
  "4-7-8": { inhale: 4, hold1: 7, exhale: 8, hold2: 0 },
  Coherent: { inhale: 5.5, hold1: 0, exhale: 5.5, hold2: 0 },
  Calm: { inhale: 4, hold1: 2, exhale: 6, hold2: 2 },
} satisfies Record<string, Timing>;
type PresetKey = keyof typeof PRESETS;
type Reading = { bpm: number | null; hrv: number | null };
type Session = { id: string; date: number; name: string; timing: Timing; seconds: number; cycles: number; before: Reading; after: Reading; whm?: { breaths: number; rounds: number; retention: number } };

// Wim Hof Method: rapid power breaths, a long hold after the final exhale, then a recovery breath
type WhmSettings = { breaths: number; breathSeconds: number; retention: number; recoveryHold: number; rounds: number };
const WHM_DEFAULT: WhmSettings = { breaths: 30, breathSeconds: 2, retention: 90, recoveryHold: 15, rounds: 3 };
type WhmKind = "inhale" | "exhale" | "hold" | "recovery-hold";
type WhmStep = { label: string; dur: number; kind: WhmKind };

function buildWhmScript(s: WhmSettings): WhmStep[] {
  const steps: WhmStep[] = [];
  for (let r = 0; r < s.rounds; r++) {
    for (let i = 0; i < s.breaths; i++) {
      steps.push({ label: `Breath ${i + 1}/${s.breaths} — Inhale`, dur: s.breathSeconds, kind: "inhale" });
      steps.push({ label: `Breath ${i + 1}/${s.breaths} — Exhale`, dur: s.breathSeconds, kind: "exhale" });
    }
    steps.push({ label: "Hold — let go", dur: s.retention, kind: "hold" });
    steps.push({ label: "Recovery breath — Inhale", dur: 3, kind: "inhale" });
    steps.push({ label: "Recovery breath — Hold", dur: s.recoveryHold, kind: "recovery-hold" });
    steps.push({ label: "Recovery breath — Exhale", dur: 2, kind: "exhale" });
  }
  return steps;
}

/** RMSSD in ms from RR intervals (ms) */
export function rmssd(rr: number[]) {
  if (rr.length < 2) return 0;
  let s = 0;
  for (let i = 1; i < rr.length; i++) s += ((rr[i] ?? 0) - (rr[i - 1] ?? 0)) ** 2;
  return Math.sqrt(s / (rr.length - 1));
}

function Index() {
  const [t, setT] = useState<Timing>(PRESETS.Box);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState(0);
  const [remain, setRemain] = useState(t.inhale);
  const [cycles, setCycles] = useState(0);
  const [mode, setMode] = useState<"phases" | "whm">("phases");
  const [whm, setWhm] = useState<WhmSettings>(WHM_DEFAULT);
  const [whmStep, setWhmStep] = useState<{ label: string; remain: number; kind: WhmKind }>({ label: "", remain: 0, kind: "inhale" });
  const whmIdxRef = useRef(0);
  const whmRemainRef = useRef(0);

  const [bpm, setBpm] = useState<number | null>(null);
  const [hrv, setHrv] = useState<number | null>(null);
  const [source, setSource] = useState<"none" | "ble" | "demo">("none");
  const [devName, setDevName] = useState("");
  const [err, setErr] = useState("");
  const rrRef = useRef<number[]>([]);
  const heartSamplesRef = useRef<HeartSample[]>([]);
  const steadySinceRef = useRef<number | null>(null);
  const [coherence, setCoherence] = useState<CoherenceLevel>("red");
  const [steadySeconds, setSteadySeconds] = useState(0);
  const coherentTiming = PHASES.every((p) => t[p.key] === PRESETS.Coherent[p.key]);
  useEffect(() => {
    heartSamplesRef.current = [];
    steadySinceRef.current = null;
    setCoherence("red");
    setSteadySeconds(0);
    if (!running || !coherentTiming || source === "none") return;
    const id = setInterval(() => {
      const now = Date.now();
      const feedback = coherenceFeedback(hasBreathingRhythm(heartSamplesRef.current, now, 11), now, steadySinceRef.current);
      steadySinceRef.current = feedback.since;
      setCoherence(feedback.level);
      setSteadySeconds(feedback.since === null ? 0 : Math.floor((now - feedback.since) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running, coherentTiming, source]);
  const [history, setHistory] = useState<{ bpm: number; hrv: number }[]>([]);

  // breathing timer
  useEffect(() => {
    if (!running || mode !== "phases") return;
    const id = setInterval(() => {
      setRemain((r) => {
        if (r > 0.1) return +(r - 0.1).toFixed(1);
        let next = phase;
        for (let i = 0; i < 4; i++) {
          next = (next + 1) % 4;
          const nextPhase = PHASES[next];
          if (nextPhase && t[nextPhase.key] > 0) break;
        }
        if (next <= phase) setCycles((c) => c + 1);
        setPhase(next);
        return t[(PHASES[next] ?? PHASES[0] ?? { key: "inhale" }).key];
      });
    }, 100);
    return () => clearInterval(id);
  }, [running, phase, t, mode]);

  // WHM timer: rapid power breaths, retention hold, then a recovery breath
  useEffect(() => {
    if (!running || mode !== "whm") return;
    const script = buildWhmScript(whm);
    if (script.length === 0) return;
    let idx = whmIdxRef.current;
    if (idx >= script.length) idx = 0;
    whmIdxRef.current = idx;
    if (idx === 0) {
      const first = script[0]!;
      whmRemainRef.current = first.dur;
      setWhmStep({ label: first.label, remain: first.dur, kind: first.kind });
    } else {
      whmRemainRef.current = whmStep.remain;
    }
    const id = setInterval(() => {
      const r = +(whmRemainRef.current - 0.1).toFixed(1);
      if (r > 0.1) {
        whmRemainRef.current = r;
        setWhmStep((prev) => ({ ...prev, remain: r }));
        return;
      }
      const next = whmIdxRef.current + 1;
      if (next >= script.length) {
        whmIdxRef.current = script.length;
        setWhmStep((prev) => ({ ...prev, label: "Round complete", remain: 0, kind: "exhale" }));
        return;
      }
      whmIdxRef.current = next;
      const s = script[next]!;
      whmRemainRef.current = s.dur;
      const perRound = whm.breaths * 2 + 4;
      const inRound = (next - 1) % perRound;
      if (inRound % 2 === 1 && inRound < whm.breaths * 2) setCycles((c) => c + 1);
      setWhmStep({ label: s.label, remain: s.dur, kind: s.kind });
    }, 100);
    return () => clearInterval(id);
  }, [running, mode, whm]);

  // stop automatically once the WHM script finishes
  useEffect(() => {
    if (running && mode === "whm" && whmIdxRef.current >= buildWhmScript(whm).length) setRunning(false);
  }, [running, mode, whmStep, whm]);

  const pushRR = (rrs: number[]) => {
    let at = Date.now();
    const stamped: HeartSample[] = [];
    for (const rr of [...rrs].reverse()) {
      stamped.unshift({ at, rr });
      at -= rr;
    }
    heartSamplesRef.current = [...heartSamplesRef.current, ...stamped].filter((s) => Date.now() - s.at <= 45000);
    rrRef.current = [...rrRef.current, ...rrs].slice(-60);
    const v = Math.round(rmssd(rrRef.current));
    if (rrRef.current.length > 3) setHrv(v);
  };

  // sample history
  useEffect(() => {
    const id = setInterval(() => {
      if (bpm && hrv) setHistory((h) => [...h, { bpm, hrv }].slice(-60));
    }, 2000);
    return () => clearInterval(id);
  }, [bpm, hrv]);

  // demo signal: RSA — HR rises on inhale, falls on exhale
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useEffect(() => {
    if (source !== "demo") return;
    let base = 72;
    const id = setInterval(() => {
      const k = PHASES[phaseRef.current]?.key;
      const target = running ? (k === "inhale" ? 74 : k === "exhale" ? 62 : 67) : 72;
      base += (target - base) * 0.3 + (Math.random() - 0.5) * 2;
      setBpm(Math.round(base));
      pushRR([60000 / base]);
    }, 900);
    return () => clearInterval(id);
  }, [source, running]);

  const connectBle = async () => {
    setErr("");
    const nav = navigator as any;
    if (!nav.bluetooth) {
      setErr("Bluetooth isn't supported in this browser. Try Chrome on desktop/Android, or use Demo mode.");
      return;
    }
    try {
      const device = await nav.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      // The link can drop right after pairing; retry the GATT connect once.
      let server = device.gatt;
      if (!server.connected) server = await server.connect();
      let svc;
      try {
        svc = await server.getPrimaryService("heart_rate");
      } catch {
        server = await device.gatt.connect();
        svc = await server.getPrimaryService("heart_rate");
      }
      const ch = await svc.getCharacteristic("heart_rate_measurement");
      await ch.startNotifications();
      ch.addEventListener("characteristicvaluechanged", (e: any) => {
        const dv: DataView = e.target.value;
        const flags = dv.getUint8(0);
        const wide = flags & 1;
        let i = 1;
        const hr = wide ? dv.getUint16(i, true) : dv.getUint8(i);
        i += wide ? 2 : 1;
        if (flags & 0x08) i += 2;
        const rrs: number[] = [];
        if (flags & 0x10) for (; i + 1 < dv.byteLength; i += 2) rrs.push((dv.getUint16(i, true) / 1024) * 1000);
        setBpm(hr);
        if (rrs.length) pushRR(rrs);
      });
      device.addEventListener("gattserverdisconnected", () => {
        setSource("none");
        setBpm(null);
        setErr("Heart monitor disconnected. Tap “Connect heart monitor” to reconnect.");
      });
      setDevName(device.name || "Heart rate monitor");
      setSource("ble");
    } catch (e: any) {
      if (e?.name === "NotFoundError") return;
      const msg = String(e?.message || "");
      setErr(
        /GATT Server is disconnected|retrieve services/i.test(msg)
          ? "The monitor dropped the connection. Keep it close and awake, then tap “Connect heart monitor” again."
          : msg || "Connection failed",
      );
    }
  };

  // session history (saved on this device)
  const [sessions, setSessions] = useState<Session[]>([]);
  useEffect(() => {
    try {
      setSessions(JSON.parse(localStorage.getItem("tide-sessions") || "[]"));
    } catch {}
  }, []);
  const saveSessions = (s: Session[]) => {
    setSessions(s);
    localStorage.setItem("tide-sessions", JSON.stringify(s));
  };
  const startRef = useRef<{ at: number; bpm: number | null; hrv: number | null; active: number; resumed: number } | null>(null);

  const toggle = () => {
    const now = Date.now();
    if (!running) {
      if (!startRef.current) startRef.current = { at: now, bpm, hrv, active: 0, resumed: now };
      else startRef.current.resumed = now;
    } else if (startRef.current) {
      startRef.current.active += now - startRef.current.resumed;
    }
    setRunning(!running);
  };

  const reset = () => {
    const s = startRef.current;
    if (s) {
      const active = s.active + (running ? Date.now() - s.resumed : 0);
      const seconds = Math.round(active / 1000);
      if (seconds >= 15) {
        const isWhm = mode === "whm";
        const preset = (Object.keys(PRESETS) as PresetKey[]).find((k) =>
          PHASES.every((p) => PRESETS[k][p.key] === t[p.key]),
        );
        saveSessions([
          {
            id: String(s.at),
            date: s.at,
            name: isWhm ? `WHM ${whm.breaths}×${whm.rounds}` : preset ?? "Custom",
            timing: isWhm
              ? { inhale: whm.breathSeconds, hold1: whm.recoveryHold, exhale: whm.breathSeconds, hold2: whm.retention }
              : { ...t },
            seconds,
            cycles,
            before: { bpm: s.bpm, hrv: s.hrv },
            after: { bpm, hrv },
            whm: isWhm ? { breaths: whm.breaths, rounds: whm.rounds, retention: whm.retention } : undefined,
          },
          ...sessions,
        ].slice(0, 50));
      }
    }
    startRef.current = null;
    setRunning(false);
    setPhase(0);
    setRemain(t.inhale);
    setCycles(0);
    whmIdxRef.current = 0;
    whmRemainRef.current = 0;
    setWhmStep({ label: "", remain: 0, kind: "inhale" });
  };

  const cur = PHASES[phase] ?? { key: "inhale" as const, label: "Inhale" };
  const dur = t[cur.key] || 1;
  const prog = 1 - remain / dur;
  const scale =
    cur.key === "inhale" ? 0.55 + 0.45 * prog : cur.key === "exhale" ? 1 - 0.45 * prog : cur.key === "hold1" ? 1 : 0.55;
  const total = PHASES.reduce((a, p) => a + t[p.key], 0);
  const matchesPreset = (k: PresetKey) => PHASES.every((p) => PRESETS[k][p.key] === t[p.key]);
  const whmDone = mode === "whm" && whmIdxRef.current >= buildWhmScript(whm).length;
  const whmProg = whmStep.dur ? 1 - whmStep.remain / whmStep.dur : 0;
  const whmScale =
    whmStep.kind === "inhale" ? 0.55 + 0.45 * whmProg
    : whmStep.kind === "exhale" ? 1 - 0.45 * whmProg
    : whmStep.kind === "recovery-hold" ? 1 : 0.55;
  const showLabel = mode === "whm" ? whmStep.label : cur.label;
  const showRemain = mode === "whm" ? whmStep.remain : remain;
  const showScale = mode === "whm" ? whmScale : scale;
  const bpmBreaths = mode === "whm" ? (60 / (whm.breathSeconds * 2)).toFixed(1) : total ? (60 / total).toFixed(1) : "0";
  const hrvLabel = hrv == null ? "" : hrv > 50 ? "Relaxed" : hrv > 25 ? "Balanced" : "Stressed";

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl font-semibold">Tide</h1>
          <p className="text-muted-foreground">Paced breathing, guided by your heart.</p>
        </div>
        <span className="text-sm text-muted-foreground">{bpmBreaths} breaths/min</span>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="flex flex-col items-center rounded-lg border bg-card p-8">
          <div className="relative flex h-80 w-80 items-center justify-center">
            <div className="absolute inset-0 rounded-full border border-primary/20" />
            <div
              className="breath-orb absolute inset-0 rounded-full"
              data-coherence={coherentTiming ? coherence : "red"}
              style={{ transform: `scale(${running ? showScale : 0.6})` }}
            />
            <div className="relative text-center">
              <div className="font-display text-3xl">{running ? showLabel : mode === "whm" && whmDone ? "Complete" : "Ready"}</div>
              <div className="mt-1 text-5xl font-semibold tabular-nums">{running ? Math.ceil(showRemain) : "—"}</div>
            </div>
          </div>
          <div className="mt-6 text-sm text-muted-foreground">{mode === "whm" ? "Breaths" : "Cycles"}: {cycles}</div>
          {coherentTiming && (
            <div className="mt-2 text-center" role="status">
              <div className="coherence-status text-sm" data-coherence={coherence}>
                {coherence === "green" ? "Sustained rhythm" : coherence === "blue" ? "Steady rhythm" : "Finding rhythm"}
                {steadySeconds > 0 && ` · ${fmtDur(steadySeconds)}`}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {source === "demo" ? "Simulated heart readings · Estimate" : "Heart rhythm estimate · Not a medical score"}
              </div>
            </div>
          )}
          <div className="mt-4 flex gap-3">
            <button
              onClick={toggle}
              className="rounded-full bg-primary px-8 py-3 font-semibold text-primary-foreground transition hover:opacity-90"
            >
              {running ? "Pause" : "Start"}
            </button>
            <button onClick={reset} className="rounded-full border px-6 py-3 hover:bg-muted">
              {startRef.current ? "Finish & save" : "Reset"}
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-4 font-display text-xl">Heart</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-muted p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full bg-pulse ${bpm ? "beat" : ""}`} /> BPM
                </div>
                <div className="text-4xl font-semibold tabular-nums">{bpm ?? "--"}</div>
              </div>
              <div className="rounded-lg bg-muted p-4">
                <div className="text-sm text-muted-foreground">HRV (RMSSD)</div>
                <div className="text-4xl font-semibold tabular-nums">
                  {hrv ?? "--"}
                  <span className="text-base font-normal text-muted-foreground"> ms</span>
                </div>
                <div className="text-xs text-accent">{hrvLabel}</div>
              </div>
            </div>
            <Spark data={history} />
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={connectBle} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                {source === "ble" ? `Connected: ${devName}` : "Connect heart monitor"}
              </button>
              <button
                onClick={() => {
                  rrRef.current = [];
                  setSource(source === "demo" ? "none" : "demo");
                }}
                className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
              >
                {source === "demo" ? "Stop demo" : "Demo mode"}
              </button>
            </div>
            {err && <p className="mt-3 text-sm text-accent">{err}</p>}
          </section>

          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-3 font-display text-xl">Timing</h2>
            <div className="mb-4 flex flex-wrap gap-2">
              {(Object.keys(PRESETS) as PresetKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setMode("phases");
                    setT(PRESETS[k]);
                    setPhase(0);
                    setRemain(PRESETS[k].inhale);
                  }}
                  aria-pressed={mode === "phases" && matchesPreset(k)}
                  className={`rounded-full border px-3 py-1 text-sm hover:bg-muted ${mode === "phases" && matchesPreset(k) ? "border-primary text-primary" : ""}`}
                >
                  {k}
                </button>
              ))}
              <button
                onClick={() => setMode("whm")}
                aria-pressed={mode === "whm"}
                className={`rounded-full border px-3 py-1 text-sm font-semibold hover:bg-muted ${mode === "whm" ? "border-primary text-primary" : ""}`}
              >
                WHM
              </button>
            </div>
            {mode === "phases" ? (
              PHASES.map((p, i) => (
                <label key={p.key} className="mb-3 block">
                  <div className="flex justify-between text-sm">
                    <span>{i === 1 ? "Pause after inhale" : i === 3 ? "Pause after exhale" : p.label}</span>
                    <span className="tabular-nums text-muted-foreground">{t[p.key]}s</span>
                  </div>
                  <input
                    type="range"
                    min={p.key === "inhale" || p.key === "exhale" ? 1 : 0}
                    max={12}
                    step={0.5}
                    value={t[p.key]}
                    onChange={(e) => setT({ ...t, [p.key]: +e.target.value })}
                    className="w-full"
                  />
                </label>
              ))
            ) : (
              <div>
                <p className="mb-4 text-xs text-muted-foreground">
                  Wim Hof Method: {whm.breaths} fast power breaths, hold after the final exhale, then one deep recovery breath — repeated {whm.rounds}×.
                </p>
                {([
                  ["Breaths per round", "breaths", 5, 40, 5],
                  ["Breath length (s)", "breathSeconds", 1, 4, 0.5],
                  ["Retention hold (s)", "retention", 15, 180, 15],
                  ["Recovery hold (s)", "recoveryHold", 5, 30, 5],
                  ["Rounds", "rounds", 1, 8, 1],
                ] as const).map(([label, key, min, max, step]) => (
                  <label key={key} className="mb-3 block">
                    <div className="flex justify-between text-sm">
                      <span>{label}</span>
                      <span className="tabular-nums text-muted-foreground">{whm[key]}{key === "breaths" || key === "rounds" ? "" : "s"}</span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={whm[key]}
                      disabled={running}
                      onChange={(e) => setWhm({ ...whm, [key]: +e.target.value } as WhmSettings)}
                      className="w-full"
                    />
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl">Session history</h2>
          {sessions.length > 0 && (
            <button onClick={() => saveSessions([])} className="text-sm text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
        </div>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Finish a session (at least 15 seconds) to see it here with your before and after heart readings.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s) => (
              <div key={s.id} className="grid gap-3 rounded-lg bg-muted p-4 sm:grid-cols-[1.2fr_1fr_1fr]">
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(s.date).toLocaleString()} · {fmtDur(s.seconds)} · {s.cycles} cycles
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.whm
                      ? `${s.whm.breaths} breaths · ${s.whm.retention}s hold · ${s.whm.rounds} rounds`
                      : `${s.timing.inhale}-${s.timing.hold1}-${s.timing.exhale}-${s.timing.hold2}s`}
                  </div>
                </div>
                <Delta label="BPM" before={s.before.bpm} after={s.after.bpm} goodWhenDown />
                <Delta label="HRV ms" before={s.before.hrv} after={s.after.hrv} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function fmtDur(s: number) {
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Delta({ label, before, after, goodWhenDown }: { label: string; before: number | null; after: number | null; goodWhenDown?: boolean }) {
  const d = before != null && after != null ? after - before : null;
  const good = d != null && (goodWhenDown ? d < 0 : d > 0);
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tabular-nums">
        {before ?? "--"} → <span className="font-semibold">{after ?? "--"}</span>
        {d != null && d !== 0 && (
          <span className={`ml-2 text-sm ${good ? "text-primary" : "text-accent"}`}>
            {d > 0 ? "+" : ""}
            {d}
          </span>
        )}
      </div>
    </div>
  );
}

function Spark({ data }: { data: { bpm: number; hrv: number }[] }) {
  if (data.length < 2) return <p className="mt-4 text-xs text-muted-foreground">Trend appears once heart data streams in.</p>;
  const line = (vals: number[]) => {
    const min = Math.min(...vals), max = Math.max(...vals) || 1;
    return vals.map((v, i) => `${(i / (vals.length - 1)) * 300},${50 - ((v - min) / (max - min || 1)) * 45}`).join(" ");
  };
  return (
    <svg viewBox="0 0 300 55" className="mt-4 h-16 w-full">
      <polyline points={line(data.map((d) => d.bpm))} fill="none" stroke="var(--pulse)" strokeWidth="2" />
      <polyline points={line(data.map((d) => d.hrv))} fill="none" stroke="var(--primary)" strokeWidth="2" />
    </svg>
  );
}
