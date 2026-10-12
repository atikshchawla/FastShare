"use client";

import type { ReactNode } from "react";
import { Tabs, type TabItem } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Sidebar of the canvas shell: a scrollable content column plus a vertical
 * tab rail. `railSide` mirrors the rail to the panel's outer edge (left
 * sidebar = rail on the left, right sidebar = rail on the right) so the
 * content always faces the canvas. The caller owns which tab is active and
 * renders the matching tab component as children.
 */
export function SidePanel({
  tabs,
  value,
  onChange,
  headerRight,
  railSide = "end",
  className,
  children,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  headerRight?: ReactNode;
  railSide?: "start" | "end";
  className?: string;
  children: ReactNode;
}) {
  const active = tabs.find((t) => t.id === value) ?? tabs[0];
  return (
    <aside
      className={cn(
        "flex min-h-0 bg-neutral-950",
        railSide === "start" && "flex-row-reverse",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2 border-b-2 border-neutral-800 bg-neutral-900 px-3 py-2">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.15em] text-neutral-200">
            {active?.label}
          </span>
          {headerRight}
        </div>
        <div className="@container min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          {children}
        </div>
      </div>
      <Tabs
        items={tabs}
        value={value}
        onChange={onChange}
        orientation="vertical"
        className="shrink-0"
      />
    </aside>
  );
}
