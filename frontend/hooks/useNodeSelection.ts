"use client";

import { useEffect, useState } from "react";

/**
 * Selection of a canvas node: click a node to select, ESC or a click on the
 * empty canvas clears it. The NODE side-panel tab and the floating inspector
 * both read this state.
 */
export function useNodeSelection() {
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedNode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { selectedNode, setSelectedNode };
}
