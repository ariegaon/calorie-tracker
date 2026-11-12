"use client";

import { useState } from "react";
import { dateOfDay, type AveragePoint, type DailyWeight } from "@/lib/weight/trend";

const WIDTH = 340;
const HEIGHT = 210;
const MARGIN = { top: 14, right: 12, bottom: 24, left: 38 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

// Chart colors: one blue series for the average, neutral marks for single weigh-ins and the goal.
const COLOR = {
  average: "#2a78d6",
  weighIn: "#8a8983",
  goal: "#52514e",
  grid: "#e7e5e4",
  text: "#52514e",
  surface: "#ffffff",
};

const dayFormat = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" });

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  const rough = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + 1e-9; tick += step) ticks.push(Number(tick.toFixed(4)));
  return ticks;
}

/**
 * Weight over time: single weigh-ins as dots, their 7-day moving average as a line, the goal as a dashed line.
 * Tapping a day shows its values. Time always runs left to right.
 */
export function WeightChart({
  daily,
  average,
  targetKg,
  unit = 'ק"ג',
}: {
  daily: DailyWeight[];
  average: AveragePoint[];
  targetKg: number | null;
  /** Unit shown next to values. The chart is also used for body measurements. */
  unit?: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  if (daily.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">עוד אין מדידות בטווח הזה.</p>;
  }

  const values = [...daily.map((d) => d.weightKg), ...average.map((a) => a.value)];
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  // The goal is drawn when it is close enough not to flatten the data.
  const showGoal = targetKg !== null && targetKg > minValue - 8 && targetKg < maxValue + 8;
  if (showGoal && targetKg !== null) {
    minValue = Math.min(minValue, targetKg);
    maxValue = Math.max(maxValue, targetKg);
  }
  const padding = Math.max(0.5, (maxValue - minValue) * 0.12);
  const yMin = minValue - padding;
  const yMax = maxValue + padding;

  const firstDay = daily[0].day;
  const lastDay = daily[daily.length - 1].day;
  const daySpan = Math.max(1, lastDay - firstDay);

  const x = (day: number) =>
    MARGIN.left + (lastDay === firstDay ? PLOT_WIDTH / 2 : ((day - firstDay) / daySpan) * PLOT_WIDTH);
  const y = (value: number) => MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * PLOT_HEIGHT;

  const ticks = niceTicks(yMin, yMax, 4);
  const averagePath = average.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const averageByDay = new Map(average.map((p) => [p.day, p.value]));

  const selectedPoint = selected !== null ? daily[selected] : null;
  const selectedAverage = selectedPoint ? averageByDay.get(selectedPoint.day) : undefined;
  const hitWidth = Math.max(16, PLOT_WIDTH / daily.length);

  const latest = daily[daily.length - 1];
  const summary =
    `גרף לאורך זמן: ${daily.length} ימי מדידה, מ-${dayFormat.format(dateOfDay(firstDay))} עד ${dayFormat.format(dateOfDay(lastDay))}. ` +
    `מדידה אחרונה ${latest.weightKg.toFixed(1)} ${unit}.`;

  return (
    <div className="space-y-2">
      <p className="min-h-5 text-sm text-slate-700" aria-live="polite">
        {selectedPoint ? (
          <>
            <span className="font-semibold">{dayFormat.format(dateOfDay(selectedPoint.day))}: </span>
            {selectedPoint.weightKg.toFixed(1)} {unit}
            {selectedAverage !== undefined ? ` · ממוצע 7 ימים ${selectedAverage.toFixed(1)} ${unit}` : ""}
          </>
        ) : (
          <span className="text-slate-500">אפשר לגעת בנקודה כדי לראות את הערך שלה.</span>
        )}
      </p>

      <div dir="ltr">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className="h-auto w-full">
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={COLOR.grid} strokeWidth={1} />
              <text x={MARGIN.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill={COLOR.text}>
                {tick}
              </text>
            </g>
          ))}

          {showGoal && targetKg !== null ? (
            <g>
              <line
                x1={MARGIN.left}
                x2={WIDTH - MARGIN.right}
                y1={y(targetKg)}
                y2={y(targetKg)}
                stroke={COLOR.goal}
                strokeWidth={1.5}
                strokeDasharray="5 4"
              />
              <text x={WIDTH - MARGIN.right} y={y(targetKg) - 5} textAnchor="end" fontSize={10} fontWeight={600} fill={COLOR.text}>
                {`יעד ${targetKg}`}
              </text>
            </g>
          ) : null}

          {selectedPoint ? (
            <line
              x1={x(selectedPoint.day)}
              x2={x(selectedPoint.day)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
              stroke={COLOR.goal}
              strokeWidth={1}
            />
          ) : null}

          {daily.map((point) => (
            <circle
              key={point.day}
              cx={x(point.day)}
              cy={y(point.weightKg)}
              r={4}
              fill={COLOR.weighIn}
              stroke={COLOR.surface}
              strokeWidth={2}
            />
          ))}

          {average.length > 1 ? (
            <path d={averagePath} fill="none" stroke={COLOR.average} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}

          <text x={MARGIN.left} y={HEIGHT - 6} textAnchor="start" fontSize={10} fill={COLOR.text}>
            {dayFormat.format(dateOfDay(firstDay))}
          </text>
          {lastDay !== firstDay ? (
            <text x={WIDTH - MARGIN.right} y={HEIGHT - 6} textAnchor="end" fontSize={10} fill={COLOR.text}>
              {dayFormat.format(dateOfDay(lastDay))}
            </text>
          ) : null}

          {daily.map((point, index) => (
            <rect
              key={`hit-${point.day}`}
              x={x(point.day) - hitWidth / 2}
              y={MARGIN.top}
              width={hitWidth}
              height={PLOT_HEIGHT}
              fill="transparent"
              onClick={() => setSelected(selected === index ? null : index)}
              onMouseEnter={() => setSelected(index)}
            />
          ))}
        </svg>
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
        <li className="flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill={COLOR.weighIn} />
          </svg>
          מדידה
        </li>
        {average.length > 1 ? (
          <li className="flex items-center gap-1.5">
            <svg width="18" height="12" aria-hidden="true">
              <line x1="1" x2="17" y1="6" y2="6" stroke={COLOR.average} strokeWidth="2" strokeLinecap="round" />
            </svg>
            ממוצע נע של 7 ימים
          </li>
        ) : null}
        {showGoal ? (
          <li className="flex items-center gap-1.5">
            <svg width="18" height="12" aria-hidden="true">
              <line x1="1" x2="17" y1="6" y2="6" stroke={COLOR.goal} strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            יעד
          </li>
        ) : null}
      </ul>
    </div>
  );
}
