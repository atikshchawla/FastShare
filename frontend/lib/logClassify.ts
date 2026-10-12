/** Classification of controller log lines for the live trace consoles. */

export type LogTone =
  | "loss"
  | "duplicate"
  | "retransmit"
  | "ack"
  | "serverData"
  | "clientData"
  | "lifecycle"
  | "sent"
  | "neutral";

/**
 * First matching category wins, in the same precedence both trace consoles
 * historically used: faults first, then protocol traffic, then lifecycle.
 */
export function classifyLogLine(text: string): LogTone {
  if (/lost|timeout/i.test(text)) return "loss";
  if (/duplicate/i.test(text)) return "duplicate";
  if (/retransmit/i.test(text)) return "retransmit";
  if (/ack/i.test(text)) return "ack";
  if (/server <- data/i.test(text)) return "serverData";
  if (/client -> data/i.test(text)) return "clientData";
  if (/complete|finished|^Server listening|Transfer started/i.test(text))
    return "lifecycle";
  if (/sent|start/i.test(text)) return "sent";
  return "neutral";
}
