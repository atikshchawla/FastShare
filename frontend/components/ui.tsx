"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border-2 border-slate-200/90 bg-white shadow-card transition-all duration-200 hover:border-slate-300",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  icon,
  badgeText,
  right,
  className,
}: {
  title: string;
  icon?: ReactNode;
  badgeText?: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between border-b-2 border-slate-100 bg-slate-50/80 px-6 py-4 rounded-t-2xl",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {icon && <span className="text-teal-700">{icon}</span>}
        <h2 className="font-display text-sm sm:text-base font-extrabold uppercase tracking-wider text-slate-800">
          {title}
        </h2>
        {badgeText && (
          <span className="rounded-md bg-slate-200/80 px-2.5 py-0.5 text-xs font-mono font-bold text-slate-700">
            {badgeText}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

const badgeTones = {
  teal: "bg-teal-50 text-teal-900 border-teal-300",
  orange: "bg-orange-50 text-orange-900 border-orange-300",
  green: "bg-emerald-50 text-emerald-900 border-emerald-300",
  amber: "bg-amber-50 text-amber-900 border-amber-300",
  red: "bg-rose-50 text-rose-900 border-rose-300",
  cyan: "bg-cyan-50 text-cyan-900 border-cyan-300",
  slate: "bg-slate-100 text-slate-700 border-slate-300",
  violet: "bg-purple-50 text-purple-900 border-purple-300",
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  tone = "slate",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border-2 px-3 py-1 text-xs font-bold tracking-tight font-mono",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const dotTones = {
  teal: "bg-teal-600 shadow-sm shadow-teal-500/50",
  orange: "bg-orange-600 shadow-sm shadow-orange-500/50",
  green: "bg-emerald-600 shadow-sm shadow-emerald-500/50",
  amber: "bg-amber-600 shadow-sm shadow-amber-500/50",
  red: "bg-rose-600 shadow-sm shadow-rose-500/50",
  cyan: "bg-cyan-600 shadow-sm shadow-cyan-500/50",
  slate: "bg-slate-500",
} as const;

export function StatusDot({
  tone = "slate",
  pulse = false,
  className,
}: {
  tone?: keyof typeof dotTones;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 rounded-full shrink-0",
        dotTones[tone],
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

export function KeyValue({
  label,
  value,
  mono = true,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0 font-mono text-xs sm:text-sm">
      <span className="text-slate-600 font-semibold">{label}</span>
      <span
        className={cn(
          "text-right font-bold text-slate-900",
          mono && "font-tabular",
          accent && "text-teal-700",
        )}
      >
        {value}
      </span>
    </div>
  );
}