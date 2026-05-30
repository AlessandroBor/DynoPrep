# Break-In RPM Cycle — Design Spec

**Date:** 2026-05-29 (reworked from the original tanh soft-clip design)
**App:** DynoPrep (Tauri + React/TypeScript) by American Dynos
**Author:** brainstormed with user

## Problem

New engines (fresh piston/rings) need extended run time to seat the rings before
they can safely reach high RPM. The proper break-in procedure is not just to *cap*
the top RPM — it is to **load and unload** the engine repeatedly: pull up to a
safe ceiling, lift off the throttle so RPM coasts down under engine braking for a
moment, then get back into it. The vacuum/pressure cycling on the overrun is what
seats the rings.

The user runs a lap (or looped series of laps) as a sequencing program on the dyno.
The app needs to overlay this load/unload break-in pattern onto the loaded lap data
so the engine is both kept under a hard RPM ceiling **and** cycled correctly.

> Superseded: the original design (a hyperbolic-tangent soft-clip that bent peaks
> toward an asymptotic ceiling) only shaved peaks. It did not produce the lift-off /
> coast-down / resume cycle the break-in procedure actually requires, so it was
> replaced wholesale by the cycle described here.

## Solution Overview

Add an optional processing stage — the **Break-In Cycle** — to the existing data
pipeline. It walks the (time-ordered) lap data as a three-phase state machine and
rewrites the RPM and Throttle channels in place (the time grid is preserved):

1. **FOLLOW** — output tracks the lap RPM, capped so it never exceeds `limitRpm`.
2. **DECAY (lift-off)** — the instant RPM reaches `limitRpm`, the throttle drops to
   0 and RPM falls linearly at `decayRate` RPM/s for `decayDuration` seconds.
3. **RESUME** — RPM moves back toward the lap data, capped at `limitRpm`:
   - If the data is **above** where the decay ended, RPM climbs at `resumeRate`
     RPM/s until it rejoins.
   - If the data is **below** (the track has dropped off), RPM keeps coasting *down*
     at `decayRate` (throttle still lifted) until it meets the data — so it never
     snaps vertically down to a lower data point.
   Then FOLLOW resumes, re-triggering the next lift-off at the limit.

   Throughout RESUME (both directions) the throttle eases from 0 back to the lap
   value over `throttleResume` seconds with a cosine ramp, keyed off time since the
   lift-off ended — so it returns quickly and smoothly regardless of RPM recovery.

Optionally, a **smoothing** pass rounds the sharp V where the decay turns into the
resume (a triangular-kernel blend over `±smoothing` seconds around each turn). The
kernel tapers to zero at the window edges, so straight runs and the limit peaks are
untouched — only the corner rounds.

This produces a repeating sawtooth between the limit and the coast-down floor,
riding on top of the real lap shape.

### Floor auto-override (key rule)

A lift-off starts at `limitRpm` and would naturally land at
`limitRpm − decayRate · decayDuration`. If that landing point is **below**
`floorRpm`, the decay rate is automatically lowered so the drop instead
interpolates smoothly down to **exactly** `floorRpm` over the same duration:

```
naturalEnd = limitRpm − decayRate · decayDuration
if naturalEnd < floorRpm:
    effectiveRate = (limitRpm − floorRpm) / decayDuration   // slower
    endRpm        = floorRpm
else:
    effectiveRate = decayRate
    endRpm        = naturalEnd
```

So RPM never undershoots the floor and never clips flat at the bottom — it always
lands on the floor right as the duration ends, then resumes.

### Parameter semantics

- **Limit RPM** — the max allowed RPM; reaching it triggers a lift-off. Output is
  hard-capped here, so the engine can never sit above it.
- **Floor RPM** — the absolute RPM a coast-down is never allowed to drop below.
- **Decay rate** (RPM/s) — how fast RPM sheds during a lift-off.
- **Decay duration** (s) — how long each lift-off lasts.
- **Resume rate** (RPM/s) — how fast RPM climbs back into the lap data afterward.
- **Smoothing** (s) — corner-rounding radius at the decay→resume turn (0 = sharp).
- **Throttle return** (s) — time for throttle to ease (cosine) from 0 back to the
  lap value once a lift-off ends. Time-based, not tied to RPM recovery.

Defaults: `enabled = false`, `limit = 13500`, `floor = 7000`, `decayRate = 1000`,
`decayDuration = 2`, `resumeRate = 2000`, `smoothing = 0.25`, `throttleResume = 0.5`.

## Lap-Time Correction (optional)

The dyno replays the lap on the CSV's time base, so a break-in lift-off would
otherwise flash past in the time the *fast* lap took it. A direct-drive kart has a
solid axle with the clutch locked at speed and no gearbox, so (absent wheel slip,
and we only modify RPM well above clutch engagement) **ground speed is rigidly
proportional to engine RPM**. Covering a fixed chunk of track at a lower RPM
therefore takes proportionally longer:

```
corrected_dt_i = original_dt_i × (RPM_original_i / RPM_limited_i)
```

The gear ratio, tyre size, and absolute speed all cancel — no need to estimate them.
The factor is exactly 1 wherever RPM was untouched, and ≥ 1 (capped at 8×, guarded
against zero RPM) in the lift zones, so the timeline only ever stretches.

Output is **resampled onto a uniform grid** over the new (longer) duration, so the
file has a constant sample rate *and* correct timestamps — playing back right
whether the dyno honours the Time column or detects the sample rate.

Functions in `filtering.ts`: `applyLapTimeCorrection(original, limited, outStep)`
(the resample) and `correctedLapTime(original, limited)` (cheap factor-sum used for
the readout). Gated by `lapTimeCorrectionEnabled`, only meaningful with the cycle on.
The Sidebar shows original vs corrected lap time and the delta added.

## Architecture & Data Flow

Pipeline in `App.tsx`'s `processedData` memo, with the cycle inserted after
`remapThrottle` and before the start/end ramps:

```
interpolateData → remapThrottle → applyBreakInCycle → applyLapTimeCorrection → applyTransition → applyEndTransition
```

Rationale: the cycle reshapes the core lap (RPM + Throttle), so the start ramp
climbs to the already-shaped first RPM and the end ramp descends from the shaped
last RPM. The cycle drives Throttle to 0 during each lift-off and eases it back in
on resume, matching a real throttle lift on the dyno. GPS is untouched.

## Components / Changes

### 1. `src/utils/filtering.ts`

- `FilterSettings` (replaces the old `rpmLimit*` fields):
  `breakInEnabled`, `breakInLimitRpm`, `breakInFloorRpm`, `breakInDecayRate`,
  `breakInDecayDuration`, `breakInResumeRate`. Defaults as above.
- `resolveDecay(startRpm, floorRpm, decayRate, decayDuration)` — pure helper
  implementing the floor auto-override; returns `{ rate, endRpm, floorLimited }`.
  Reused by the UI to preview the decay bottom.
- `applyBreakInCycle(data, settings)` — the FOLLOW/DECAY/RESUME state machine.
  Defensive clamps: floor is clamped to ≤ limit; negative rates/durations clamped
  to 0; empty data returned unchanged.

### 2. `src/App.tsx`

- `processedData` calls `applyBreakInCycle` (gated on `breakInEnabled`).
- A `breakInInfo` memo computes the readout: decay bottom (`endRpm`),
  `floorLimited`, and a **lift-off count** (rising edges where processed RPM
  reaches the limit). Passed to `Sidebar`.
- Passes `breakInEnabled / breakInLimitRpm / breakInFloorRpm` to `DataCharts`.

### 3. `src/components/Sidebar.tsx` — "Break-In Cycle" section

Toggle + reset, then five controls (slider + number each): Limit RPM, Floor RPM,
Decay rate, Decay duration, Resume rate. Plus a live readout: Raw peak, Lift-off
at, Drops to (with "(floor)" tag when auto-limited), and Lift-offs this lap.

### 4. `src/components/DataCharts.tsx` — reference lines

Dashed red **Limit** line and dashed gray **Floor** line on the RPM axis when the
cycle is enabled. The Tooltip already reports exact RPM on hover.

## Error Handling / Edge Cases

- Floor ≥ limit, or zero/negative params: clamped defensively; UI ranges also keep
  values sane.
- Data never reaching the limit: no lift-offs, output = data (capped).
- A long plateau above the limit: produces repeated sawtooth cycles across it
  (intended — that is the load/unload break-in pattern).
- During DECAY/RESUME, if the underlying data naturally drops below the synthetic
  line, RESUME rejoins immediately and FOLLOW tracks it down.
- Disabled: stage skipped entirely.

## Testing

Manual verification (production build per project convention: `npm run build`):
1. Import a CSV whose RPM peaks above the limit.
2. Enable the cycle. Confirm: RPM is capped at the limit; each time it reaches the
   limit the throttle goes to 0 and RPM coasts down at the decay rate; it climbs
   back into the data at the resume rate; the Limit/Floor reference lines and the
   readout match the chart.
3. Set decay rate × duration so the natural bottom is below the floor; confirm the
   drop instead lands exactly on the floor (slower) and the readout shows "(floor)".
4. Export and confirm the CSV's RPM never exceeds the limit nor drops below the
   floor during a lift-off, and Throttle is 0 through each coast-down.
5. Toggle off → trace returns to original.

## Out of Scope (YAGNI)

- Automatic multi-stage progression / scheduling (user manages stages manually).
- Per-segment limits within a single export.
- Persisting settings between sessions.
- Backend (Rust) changes — entirely front-end pipeline + UI.
