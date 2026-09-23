"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Neo-Brutalist panel — thick border, hard shadow, no rounded corners */
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
        "border-2 border-neutral-700 bg-neutral-900 shadow-[4px_4px_0px_#000]",
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
    <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-800 px-4 py-3">
      <div className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.15em] text-neutral-200">
        {icon && <span className="text-cyan-400">{icon}</span>}
        {title}
      </div>
      {right}
    </div>
  );
}

const badgeTones = {
  green: "bg-green-500/20 text-green-400 border-green-500",
  amber: "bg-amber-500/20 text-amber-400 border-amber-500",
  red: "bg-red-500/20 text-red-400 border-red-500",
  cyan: "bg-cyan-500/20 text-cyan-400 border-cyan-500",
  slate: "bg-neutral-800 text-neutral-400 border-neutral-600",
  violet: "bg-violet-500/20 text-violet-400 border-violet-500",
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
        "inline-flex items-center gap-1.5 border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const dotTones = {
  green: "bg-green-400",
  amber: "bg-amber-400",
  red: "bg-red-500",
  cyan: "bg-cyan-400",
  slate: "bg-neutral-500",
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
        "inline-block h-3 w-3",
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
      <span className="text-[12px] font-bold uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span
        className={cn(
          "text-right text-[13px] font-semibold",
          mono && "font-mono-num font-mono text-neutral-100",
          accent && "text-cyan-400",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-neutral-500">
      {children}
    </p>
  );
}