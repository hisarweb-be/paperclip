import type { IssueWorkProduct } from "@paperclipai/shared";

/**
 * The house status-chip vocabulary (HIS-2659).
 *
 * This lived inside `components/task-chat/RichWorkProductCard.tsx` and is the
 * single source of truth for how any work product or artifact is chipped. It
 * was lifted into `lib/` so the artifacts page can use the *same* semantics
 * instead of keeping a private dictionary of its own (the rejected route:
 * see HIS-2659, "de chip volgt de bestaande vocabulaire van het huis").
 *
 * The module is deliberately dependency-free (a type-only import), so neither
 * the artifacts page nor the chat cards can end up in an import cycle through
 * it.
 */
export type StateChip = {
  label: string;
  tone: "progress" | "failure" | "review" | "success" | "neutral";
  dashed?: boolean;
};

/** Resting states stay quiet. A completed work product never gets a chip. */
export function stateChipFor(
  kind: IssueWorkProduct["type"],
  status: string | null | undefined,
  reviewState: IssueWorkProduct["reviewState"] | string | null | undefined,
): StateChip | null {
  if (reviewState === "changes_requested" || status === "changes_requested") {
    return { label: "Changes requested", tone: "failure" };
  }
  if (reviewState === "needs_board_review" || status === "ready_for_review") {
    return { label: "Review", tone: "review" };
  }
  if (["failed", "unhealthy", "down"].includes(status ?? "")) {
    return { label: "Failed", tone: "failure" };
  }
  if (["pending", "opening"].includes(status ?? "")) {
    return { label: status === "opening" ? "Opening" : "Pending", tone: "progress", dashed: true };
  }
  if (kind === "pull_request" && (status === "active" || status === "open")) {
    return { label: "Open", tone: "progress" };
  }
  if (kind === "pull_request" && status === "draft") {
    return { label: "Draft", tone: "review" };
  }
  if (kind === "pull_request" && status === "merged") {
    return { label: "Merged", tone: "success" };
  }
  if (kind === "pull_request" && status === "closed") {
    return { label: "Closed", tone: "neutral" };
  }
  if (kind === "runtime_service" && status === "active") {
    return { label: "Running", tone: "progress" };
  }
  if (kind === "runtime_service" && status === "closed") {
    return { label: "Stopped", tone: "failure" };
  }
  return null;
}

/**
 * The CSS variable that carries a tone's base hue. Consumers set it as a local
 * `--sc` and the `.status-chip` / `.status-fill` recipes in `index.css` derive
 * the fill, text and border from it, so light and dark mode share one hue.
 */
export function chipCssVar(tone: StateChip["tone"]): string {
  switch (tone) {
    case "failure":
      return "--status-task-blocked";
    case "success":
      return "--status-task-done";
    case "neutral":
      return "--status-task-cancelled";
    case "review":
      return "--status-task-in_review";
    default:
      return "--status-task-in_progress";
  }
}
