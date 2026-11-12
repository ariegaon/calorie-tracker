"use client";

import { useState } from "react";
import type { ReportDay } from "@/lib/reports/report";
import { dateOfDay } from "@/lib/weight/trend";

const WIDTH = 340;
const HEIGHT = 200;
const MARGIN = { top: 12, right: 8, bottom: 24, left: 40 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;

// Two series in fixed order: consumed (blue), burned (orange). Text stays in neutral ink.
const COLOR = { consumed: "#2a78d6", burned: "#eb6834", grid: "#e7e5e4", text: "#52514e", missing: "#d6d3d1" };

const dayFormat = new Intl.DateTimeFormat("he-IL", { weekday: "short", day: "numeric", month: "numeric" });
const shortDay = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" });

function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((step) => step >= value) ?? value;
}

/** Calories consumed and burned per day, as paired bars. Days without a food log show the burned bar only. */
export function BalanceChart({ days }: { days: ReportDay[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (days.length === 0) return null;

  const yMax = niceMax(Math.max(...days.map((d) => Math.max(d.documented ? d.consumedKcal : 0, d.burnedKcal))));
  const ticks = [0, yMax / 2, yMax];
  const slot = PLOT_WIDTH / days.length;
  const gap = 2;
  const barWidth = Math.max(2, Math.min(14, (slot - gap * 3) / 2));
  const y = (value: number) => MARGIN.top + (1 - value / yMax) * PLOT_HEIGHT;
  const baseline = MARGIN.top + PLOT_HEIGHT;
  const radius = Math.min(3, barWidth / 2);

  const bar = (x: number, value: number, color: string, key: string) => {
    const top = y(value);
    const height = baseline - top;
    if (height <= 0.5) return null;
    const r = Math.min(radius, height);
    // Rounded at the data end only, square on the baseline.
    const d = `M${x},${baseline} V${top + r} Q${x},${top} ${x + r},${top} H${x + barWidth - r} Q${x + barWidth},${top} ${x + barWidth},${top + r} V${baseline} Z`;
    return <path key={key} d={d} fill={color} />;
  };

  const picked = selected !== null ? days[selected] : null;
  const labelEvery = days.length > 10 ? Math.ceil(days.length / 6) : 1;

  return (
    <div className="space-y-2">
      <p className="min-h-10 text-sm text-slate-700" aria-live="polite">
        {picked ? (
          <>
            <span className="font-semibold">{dayFormat.format(dateOfDay(picked.day))}: </span>
            {picked.documented ? `נצרכו ${Math.round(picked.consumedKcal).toLocaleString("he-IL")}` : "לא נרשם מזון"}
            {` · הוצאה ${Math.round(picked.burnedKcal).toLocaleString("he-IL")} קק"ל`}
          </>
        ) : (
          <span className="text-slate-500">אפשר לגעת ביום כדי לראות את הערכים שלו.</span>
        )}
      </p>

      <div dir="ltr">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`קלוריות שנצרכו מול הוצאה משוערת, ${days.length} ימים`}
          className="h-auto w-full"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={COLOR.grid} strokeWidth={1} />
              <text x={MARGIN.left - 6} y={y(tick) + 3.5} textAnchor="end" fontSize={10} fill={COLOR.text}>
                {Math.round(tick).toLocaleString("en-US")}
              </text>
            </g>
          ))}

          {days.map((day, index) => {
            const center = MARGIN.left + slot * index + slot / 2;
            return (
              <g key={day.day}>
                {selected === index ? (
                  <rect x={center - slot / 2} y={MARGIN.top} width={slot} height={PLOT_HEIGHT} fill={COLOR.grid} opacity={0.6} />
                ) : null}
                {day.documented ? (
                  bar(center - barWidth - gap / 2, day.consumedKcal, COLOR.consumed, "c")
                ) : (
                  <circle cx={center - barWidth / 2 - gap / 2} cy={baseline - 4} r={2} fill={COLOR.missing} />
                )}
                {bar(center + gap / 2, day.burnedKcal, COLOR.burned, "b")}
                {index % labelEvery === 0 ? (
                  <text x={center} y={HEIGHT - 7} textAnchor="middle" fontSize={9} fill={COLOR.text}>
                    {shortDay.format(dateOfDay(day.day))}
                  </text>
                ) : null}
                <rect
                  x={center - slot / 2}
                  y={MARGIN.top}
                  width={slot}
                  height={PLOT_HEIGHT + 16}
                  fill="transparent"
                  onClick={() => setSelected(selected === index ? null : index)}
                  onMouseEnter={() => setSelected(index)}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: COLOR.consumed }} />
          נצרך
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: COLOR.burned }} />
          הוצאה (הערכה)
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: COLOR.missing }} />
          יום בלי רישום מזון
        </li>
      </ul>
    </div>
  );
}
