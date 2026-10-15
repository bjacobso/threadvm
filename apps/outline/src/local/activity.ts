import type { RunEvent } from "@threadvm/shared/domain";

export interface ActivityLine {
  readonly time: number;
  readonly text: string;
  readonly kind: string;
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
/** ACP chunks are transport frames, not separate messages in the activity view. */
export const activity = (
  events: ReadonlyArray<RunEvent>,
  runId: string,
): ActivityLine[] => {
  const lines: ActivityLine[] = [];
  for (const event of events) {
    if (event.runId !== runId || event.run) continue;
    const signal = event.agent;
    if (signal?.type === "update") {
      const payload = object(signal.payload),
        content = object(payload.content);
      if (
        payload.sessionUpdate === "agent_message_chunk" &&
        typeof content.text === "string"
      ) {
        const previous = lines.at(-1);
        if (previous?.kind === "agent_message_chunk")
          lines[lines.length - 1] = {
            ...previous,
            text: previous.text + content.text,
          };
        else
          lines.push({
            time: event.time,
            text: content.text,
            kind: "agent_message_chunk",
          });
      } else if (typeof payload.title === "string")
        lines.push({ time: event.time, text: payload.title, kind: "tool" });
      continue;
    }
    const text =
      signal?.type === "initialized"
        ? `Connected to ${object(object(signal.payload).agentInfo).name ?? "ACP agent"}`
        : signal?.type === "session"
          ? "ACP session created"
          : signal?.type === "permission_resolved"
            ? "Permission answered"
            : signal?.type === "turn_complete"
              ? "Agent turn completed"
              : signal?.type === "cancelled"
                ? "Cancellation requested"
                : event.kind === "commit"
                  ? `Code commit ${event.codeSha ?? event.message}`
                  : (signal?.title ??
                    event.message ??
                    (event.kind === "started"
                      ? "Local executor started"
                      : event.kind));
    lines.push({ time: event.time, text, kind: signal?.type ?? event.kind });
  }
  return lines;
};
