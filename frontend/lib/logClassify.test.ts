import { describe, expect, it } from "vitest";
import { classifyLogLine } from "./logClassify";

describe("classifyLogLine", () => {
  it("faults win over protocol traffic (precedence order)", () => {
    // a loss line also mentions ack-ish words; loss must still win
    expect(classifyLogLine("DATA #12 lost -> timeout (1)")).toBe("loss");
    expect(classifyLogLine("ACK #3 lost (simulated)")).toBe("loss");
    expect(classifyLogLine("duplicate packet #7 re-ACKed")).toBe("duplicate");
    expect(classifyLogLine("CLIENT -> DATA #4 RETRANSMIT (attempt 2)")).toBe(
      "retransmit",
    );
  });

  it("classifies each protocol family", () => {
    expect(classifyLogLine("CLIENT <- ACK #9 received")).toBe("ack");
    expect(classifyLogLine("SERVER <- DATA #3 received")).toBe("serverData");
    expect(classifyLogLine("CLIENT -> DATA #3 sent (1024B)")).toBe(
      "clientData",
    );
    expect(classifyLogLine("Transfer finished in 1.20s")).toBe("lifecycle");
    expect(classifyLogLine("Server listening on UDP port 5001")).toBe(
      "lifecycle",
    );
    expect(classifyLogLine("CLIENT -> START #0 sent")).toBe("sent");
    expect(classifyLogLine("some unrelated line")).toBe("neutral");
  });

  it("is case-insensitive where the console needs it", () => {
    expect(classifyLogLine("DATA #2 TIMEOUT after 100ms")).toBe("loss");
    expect(classifyLogLine("Duplicate detected")).toBe("duplicate");
  });
});
