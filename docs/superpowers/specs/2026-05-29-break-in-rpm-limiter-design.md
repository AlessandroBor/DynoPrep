# Break-In RPM Limiter — Design Spec

**Date:** 2026-05-29
**App:** DynoPrep (Tauri + React/TypeScript) by American Dynos
**Author:** brainstormed with user

## Problem

New engines (fresh piston/rings) need extended run time to seat the rings before
they can safely reach high RPM. Pulling too much RPM too early can seize the
engine. The user runs a lap (or looped series of laps) as a sequencing program on
the dyno — e.g. 25 minutes at a lower RPM cap for "stage 1", then re-exports with
a higher cap for "stage 2", and so on. Stages are managed manually by the user
(separate CSV exports).

The app needs a feature to **limit the top RPM of the loaded lap data** so the
engine cannot exceed a safe ceiling — and the limiting must be **gradual** (a
smooth rolloff), not a flat hold/clip at the ceiling. Target ceilings are around
11,000 RPM and up.

## Solution Overview

Add an optional processing stage — the **Break-In RPM Limiter** — to the existing
data pipeline. It applies a smooth-knee compression curve to the RPM channel:

- Below an **onset** RPM, values pass through unchanged (low/mid-range preserved).
- Above the onset, values roll off along a **hyperbolic-tangent (tanh)** curve
  that asymptotically approaches the **ceiling** but never reaches it.

This guarantees the engine is structurally prevented from ever sitting pinned at
the hard limit, and produces no flat plateaus — peaks still rise and fall, just
compressed near the top.

### Chosen curve: pure asymptotic tanh

`ceiling` is treated as a **hard safety limit** (an asymptote), not the literal
peak. The actual output peak lands somewhat below the ceiling depending on how
high the raw data peaked. The user explicitly accepted this trade-off **on the
condition** that the UI clearly previews the resulting peak RPM (see Peak Readout
below) so there is never a surprise.

Curve definition (RPM in → RPM out):

```
limit(rpm) = rpm                                                  if rpm <= onset
limit(rpm) = onset + (ceiling - onset) * tanh((rpm - onset) / (ceiling - onset))
                                                                 if rpm  > onset
```

Properties:
- Continuous and C¹-smooth (no kink at the onset; the slope is 1 at onset and
  decreases smoothly above it).
- Strictly bounded: output < ceiling for all finite inputs.
- Independent of the dataset's global peak (purely point-wise).

Reference output values (onset 10,000 / ceiling 13,000, band = 3,000):

| Raw peak in | Output peak |
|-------------|-------------|
| 12,000      | ~11,985     |
| 13,000      | ~12,285     |
| 14,000      | ~12,610     |
| 16,000      | ~12,890     |
| ∞           | 13,000 (never reached) |

### Parameter semantics

- **Onset** — the RPM where the curve starts bending. The gap between onset and
  ceiling is the rolloff band: wider band = softer/more gradual rolloff (but pulls
  down more mid-range); narrower band = closer to a hard cap.
- **Ceiling** — the absolute RPM the output will approach but never exceed.

Defaults: `enabled = false`, `onset = 8000`, `ceiling = 11000`.

## Architecture & Data Flow

The app has an existing pure-function pipeline in `src/utils/filtering.ts`, applied
in `App.tsx`'s `processedData` memo:

```
interpolateData → remapThrottle → applyTransition (start) → applyEndTransition (end)
```

The limiter is inserted as a new stage **after `remapThrottle` and before the
transitions**:

```
interpolateData → remapThrottle → applyRpmLimit → applyTransition → applyEndTransition
```

Rationale for ordering:
- The limiter operates on the RPM of the core lap content.
- Placing it before the transitions means the start ramp climbs *to* the limited
  first-RPM and the end ramp descends *from* the limited last-RPM, keeping ramps
  consistent with the capped lap.
- The transition ramp RPMs (default 4000 start / 2000 end) sit below the onset, so
  they are unaffected regardless.

The limiter touches **RPM only**. The Throttle channel and the Throttle Editor are
untouched.

## Components / Changes

### 1. `src/utils/filtering.ts`

- Extend `FilterSettings` with:
  - `rpmLimitEnabled: boolean`
  - `rpmLimitOnset: number`
  - `rpmLimitCeiling: number`
- Extend `DEFAULT_FILTERS` with `false / 8000 / 11000`.
- Add a pure helper for a single value (the **core curve** — to be written as a
  learning contribution by the user during implementation):
  ```ts
  // softLimitRpm(rpm, onset, ceiling): number
  ```
- Add the stage function:
  ```ts
  export function applyRpmLimit(
    data: DataPoint[], onset: number, ceiling: number
  ): DataPoint[]
  ```
  which maps each point's `rpm` through `softLimitRpm`. Guard clauses: if
  `ceiling <= 0` or `ceiling <= onset`, fall back to a plain clamp at `ceiling`
  (defensive — the UI prevents this state).

### 2. `src/App.tsx`

- Insert one line into the `processedData` memo, after `remapThrottle` and before
  the start transition, gated on `filters.rpmLimitEnabled`.
- Compute two peak values for the readout and pass them to `Sidebar`:
  - `rpmPeakOriginal` = max RPM over the interpolated, pre-limit lap data.
  - `rpmPeakLimited`  = max RPM over the post-limit data.
  (Computed from the same memo so they stay in sync with the controls.)

### 3. `src/components/Sidebar.tsx` — new "Break-In Limiter" section

Mirrors the existing Start/End Transition sections (header + reset + enable toggle,
then revealed controls when enabled):

- Enable toggle + reset-to-default button.
- **Onset** slider + number input (range ~4,000–14,000, step 100).
- **Ceiling** slider + number input (range ~8,000–16,000, step 100).
- **Peak Readout** (the user's key requirement): a small live readout showing
  `Resulting peak: ~X,XXX rpm` (from `rpmPeakLimited`) alongside
  `Raw peak: Y,YYY rpm` (from `rpmPeakOriginal`), so the user can preview the true
  top RPM these settings produce before exporting.
- Short helper text explaining onset vs ceiling in plain language.
- New props on `Sidebar`: `rpmPeakOriginal: number`, `rpmPeakLimited: number`.

### 4. `src/components/DataCharts.tsx` — visual zones

- Add a dashed `ReferenceLine` at the **ceiling** (red) on the `rpm` Y-axis when
  the limiter is enabled.
- Add a dashed `ReferenceLine` at the **onset** (lighter/gray) on the `rpm` axis
  when enabled.
- These make the three zones (untouched / rolloff / approaching ceiling) visible
  while hovering. The existing Tooltip already reports the exact RPM at the hovered
  point, satisfying "highlight the RPM on hover."
- New props: `rpmLimitEnabled: boolean`, `rpmLimitOnset: number`,
  `rpmLimitCeiling: number` (passed from `App.tsx`).

## Error Handling / Edge Cases

- `ceiling <= onset` or `ceiling <= 0`: `applyRpmLimit` falls back to a hard clamp
  at `ceiling`; the Sidebar inputs also constrain values so this is not reachable
  via normal UI use.
- Empty data: stage returns input unchanged (matches existing stages' guards).
- Disabled: stage is skipped entirely; peaks readout still reflects raw = limited.
- Reference lines only render when the limiter is enabled, to avoid clutter.

## Testing

Manual verification (production build per project convention: `npm run build`):
1. Import a CSV whose RPM peaks above 11,000.
2. Enable the limiter (onset 8,000 / ceiling 11,000). Confirm:
   - The RPM trace below 8,000 is unchanged.
   - Peaks roll off smoothly and stay under 11,000 (no flat tops).
   - The "Resulting peak" readout matches the visible chart peak.
   - Ceiling/onset reference lines appear at the correct heights.
   - Hovering shows the correct RPM in the tooltip.
3. Raise the ceiling (e.g. to 13,000) and confirm the resulting peak readout and
   chart update live.
4. Export and confirm the written CSV's RPM column never exceeds the ceiling.
5. Toggle the limiter off and confirm the trace returns to original.

Unit-level check (optional, matches the pure-function style of `filtering.ts`):
`softLimitRpm` returns the input unchanged below onset, stays strictly below
ceiling above onset, and is monotonically increasing.

## Out of Scope (YAGNI)

- Automatic multi-stage progression / scheduling (user manages stages manually).
- Time-varying or per-segment ceilings within a single export.
- Persisting limiter settings between sessions.
- Backend (Rust) changes — this is entirely front-end pipeline + UI.

## Learning-Mode Contribution

During implementation, the scaffolding (settings, pipeline wiring, UI, reference
lines, peak readout) will be built out, and the user will write the core
`softLimitRpm` curve function (~6 lines) — the heart of the feature, where engine
domain knowledge applies (e.g. whether to treat onset as a fixed RPM or derive it
as a margin below the ceiling).
