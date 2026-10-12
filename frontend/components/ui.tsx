"use client";

import { ChevronDown } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/** Neo-Brutalist panel — thick border, hard shadow, no rounded corners */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="border-2 border-neutral-700 bg-neutral-900 shadow-[4px_4px_0px_#000]">
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
    <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-800 px-3 py-2.5">
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

type BadgeTone = keyof typeof badgeTones;

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

/* ---- shared form / action primitives ------------------------------- */

const buttonVariants = {
  primary:
    "border-cyan-500 bg-cyan-500 text-black hover:bg-cyan-400 hover:border-cyan-400",
  success:
    "border-green-500 bg-green-500 text-black hover:bg-green-400 hover:border-green-400",
  danger:
    "border-red-500 bg-red-500/20 text-red-300 hover:bg-red-500/30 hover:border-red-400",
  amber:
    "border-amber-500 bg-amber-500 text-black hover:bg-amber-400 hover:border-amber-400",
  ghost: "border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-500 hover:text-white",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

const buttonSizes = {
  sm: "px-2 py-1 text-[11px] shadow-[2px_2px_0px_#000]",
  md: "px-3 py-1.5 shadow-[3px_3px_0px_#000]",
  lg: "px-4 py-3 text-sm shadow-[4px_4px_0px_#000]",
} as const;

export function Button({
  variant = "ghost",
  size = "md",
  className,
  children,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 border-2 font-mono font-black uppercase tracking-wider transition active:translate-x-0.5 active:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

const fieldControlClass =
  "w-full border-2 border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs font-bold text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-cyan-400 disabled:opacity-50";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldControlClass, className)} {...props} />;
}

export function NumberInput({
  value,
  onChange,
  suffix,
  disabled,
  className,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center border-2 border-neutral-700 bg-neutral-950 transition-colors focus-within:border-cyan-400",
        disabled && "opacity-50",
        className,
      )}
    >
      <input
        inputMode="numeric"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        className="w-full bg-transparent px-2 py-1.5 font-mono text-xs font-bold text-white outline-none placeholder:text-neutral-600"
      />
      {suffix && (
        <span className="shrink-0 pr-2 font-mono text-[10px] font-bold text-neutral-500">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(fieldControlClass, "cursor-pointer appearance-none pr-7", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={12}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500"
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  onLabel = "ON",
  offLabel = "OFF",
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full cursor-pointer border-2 px-2 py-1.5 font-mono text-xs font-bold uppercase transition",
        checked
          ? "border-green-500 bg-green-500/20 text-green-300"
          : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {checked ? onLabel : offLabel}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block font-mono text-[10px] text-neutral-600">{hint}</span>
      )}
    </label>
  );
}

const statTones = {
  neutral: "text-white",
  cyan: "text-cyan-400",
  green: "text-green-400",
  amber: "text-amber-400",
  red: "text-red-400",
  violet: "text-violet-400",
} as const;

export function StatCell({
  label,
  value,
  sub,
  tone = "neutral",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof statTones;
  className?: string;
}) {
  return (
    <div className={cn("border-2 border-neutral-800 bg-neutral-950 px-3 py-2", className)}>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span className={cn("block font-mono text-[13px] font-black", statTones[tone])}>
        {value}
      </span>
      {sub && (
        <span className="block font-mono text-[10px] text-neutral-600">{sub}</span>
      )}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function Tabs({
  items,
  value,
  onChange,
  orientation = "horizontal",
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  const vertical = orientation === "vertical";
  return (
    <div
      className={cn(
        "flex gap-1 bg-neutral-900 p-1",
        vertical ? "flex-col border-l-2 border-neutral-700" : "border-2 border-neutral-700",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.id)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 font-mono text-[11px] font-black uppercase tracking-wider transition",
              vertical
                ? "rotate-180 px-1.5 py-3 [writing-mode:vertical-rl]"
                : "px-3 py-1.5",
              active
                ? "bg-cyan-500 text-black"
                : "text-neutral-500 hover:bg-neutral-800 hover:text-white",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
