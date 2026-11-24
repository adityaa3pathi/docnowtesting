'use client';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SUGAR_TIMING_LABEL, chartPoints, type SugarTiming, type VitalKind, type VitalReading } from '@/lib/vitals';

/**
 * Trend of one kind of reading: BP (upper and lower numbers, one mmHg axis) or blood sugar (mg/dL).
 * Only the numbers: no "normal" bands or colours that judge a value (no medical advice).
 * Palette checked with the dataviz validator (light surface): blue #2a78d6, orange #eb6834.
 */
const BLUE = '#2a78d6';
const ORANGE = '#eb6834';

const day = (t: number) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const when = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

type Point = ReturnType<typeof chartPoints>[number];

function Tip({ active, payload, kind }: { active?: boolean; payload?: { payload: Point }[]; kind: VitalKind }) {
    const p = active && payload?.[0]?.payload;
    if (!p) return null;
    return (
        <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
            <p className="font-semibold text-ink">{when(p.t)}</p>
            {kind === 'BP' ? (
                <p className="text-ink-muted"><span className="font-semibold text-ink">{p.systolic}/{p.diastolic}</span> mmHg</p>
            ) : (
                <p className="text-ink-muted">
                    <span className="font-semibold text-ink">{p.glucose}</span> mg/dL{p.timing ? ` · ${SUGAR_TIMING_LABEL[p.timing as SugarTiming]}` : ''}
                </p>
            )}
        </div>
    );
}

function Key({ color, label }: { color: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="h-0.5 w-4 rounded-full" style={{ background: color }} aria-hidden /> {label}
        </span>
    );
}

export function VitalsChart({ readings, kind, height = 200 }: { readings: VitalReading[]; kind: VitalKind; height?: number }) {
    const points = chartPoints(readings);
    if (points.length === 0) return null;
    const first = points[0].t;
    const last = points[points.length - 1].t;
    const label = kind === 'BP'
        ? `Blood pressure trend, ${points.length} readings from ${day(first)} to ${day(last)}. Every reading is listed below.`
        : `Blood sugar trend, ${points.length} readings from ${day(first)} to ${day(last)}. Every reading is listed below.`;
    const dot = { r: 4, strokeWidth: 2, stroke: 'var(--color-surface, #fff)' };
    return (
        <figure className="space-y-2">
            {kind === 'BP' && (
                <div className="flex flex-wrap gap-4" aria-hidden>
                    <Key color={BLUE} label="Upper (systolic)" />
                    <Key color={ORANGE} label="Lower (diastolic)" />
                </div>
            )}
            <div role="img" aria-label={label} style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                        <CartesianGrid vertical={false} stroke="#e7e5e4" />
                        <XAxis
                            dataKey="t"
                            type="number"
                            scale="time"
                            domain={first === last ? [first - 86_400_000, last + 86_400_000] : ['dataMin', 'dataMax']}
                            tickFormatter={day}
                            tick={{ fontSize: 11, fill: '#78716c' }}
                            tickLine={false}
                            axisLine={{ stroke: '#d6d3d1' }}
                            minTickGap={24}
                        />
                        <YAxis
                            tick={{ fontSize: 11, fill: '#78716c' }}
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            domain={['auto', 'auto']}
                        />
                        <Tooltip content={<Tip kind={kind} />} cursor={{ stroke: '#a8a29e', strokeWidth: 1 }} />
                        {kind === 'BP' ? (
                            <>
                                <Line type="linear" dataKey="systolic" name="Upper" stroke={BLUE} strokeWidth={2} dot={{ ...dot, fill: BLUE }} activeDot={{ r: 5 }} isAnimationActive={false} />
                                <Line type="linear" dataKey="diastolic" name="Lower" stroke={ORANGE} strokeWidth={2} dot={{ ...dot, fill: ORANGE }} activeDot={{ r: 5 }} isAnimationActive={false} />
                            </>
                        ) : (
                            <Line type="linear" dataKey="glucose" name="Sugar" stroke={BLUE} strokeWidth={2} dot={{ ...dot, fill: BLUE }} activeDot={{ r: 5 }} isAnimationActive={false} />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <figcaption className="text-xs text-ink-subtle">{kind === 'BP' ? 'mmHg' : 'mg/dL'} · {points.length === 1 ? '1 reading' : `${points.length} readings`}</figcaption>
        </figure>
    );
}
