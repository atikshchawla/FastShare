"use client";

import { PacketMonitor } from "@/components/PacketMonitor";
import type { FeedLine, PacketEntry } from "@/lib/types";

export function PacketsTab({
  packets,
  feed,
}: {
  packets: PacketEntry[];
  feed: FeedLine[];
}) {
  return <PacketMonitor packets={packets} feed={feed} />;
}
