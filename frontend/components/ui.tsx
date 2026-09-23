"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Column header / label used at the top of every section. */
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
        "rounded-xl border border-slate-800/80 bg-slate-900/50 backdrop-blur-sm",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]",
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
  right,
}: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/70 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-widest text-slate-400">
        {icon && <span className="text-cyan-400/90">{icon}</span>}
        {title}
      </div>
      {right}
    </div>
  );
}

const badgeTones = {
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  red: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
  slate: "bg-slate-500/10 text-slate-400 border-slate-600/40",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/30",
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
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const dotTones = {
  green: "bg-emerald-400",
  amber: "bg-amber-400",
  red: "bg-rose-500",
  cyan: "bg-cyan-400",
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
        "inline-block h-2.5 w-2.5 rounded-full",
        dotTones[tone],
        pulse && "status-pulse",
        className,
      )}
    />
  );
}

/** Key/value row used in status cards. */
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
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-[12px] uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span
        className={cn(
          "text-right text-[13px]",
          mono && "font-mono-num font-mono text-slate-200",
          accent && "text-cyan-300",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
      {children}
    </p>
  );
}