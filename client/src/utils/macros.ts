export interface Macro {
  label: string;
  data: string;
  variant?: "primary" | "danger" | "default";
}

export const FALLBACK_MACROS: Macro[] = [
  { label: "y", data: "y\r" },
  { label: "n", data: "n\r" },
  { label: "continue", data: "continue\r" },
  { label: "ctrl-c", data: "\x03", variant: "danger" },
];

const ARROW_DOWN = "\x1b[B";
const ENTER = "\r";

export function parseNumberedOptions(tailText: string): Macro[] | null {
  const recent = tailText.slice(-1500);
  // ❯/› must be directly before the number (same line, only whitespace between).
  // This prevents matching a standalone ❯ (Claude Code's prompt cursor) paired
  // with random digits from spinner animations.
  const matches = [
    ...recent.matchAll(/(?:^|\n)[ \t]*([❯›]?)[ \t]*(\d+)[.)]\s+(.+)/gm),
  ];
  if (matches.length < 2) return null;

  // Only count ❯/› as a selector indicator if the cursor is on the SAME match
  // as a number (i.e., group 1 is non-empty in a match that also has group 2).
  const isSelector =
    matches.some((m) => m[1] && m[2]) ||
    /enter to confirm/i.test(recent);

  const cursorOnNum = matches.find((m) => m[1])
    ? matches.find((m) => m[1])![2]
    : "1";

  const seen = new Set<string>();
  const items: { num: string; label: string }[] = [];
  for (const m of matches) {
    const num = m[2];
    if (seen.has(num)) continue;
    seen.add(num);
    let label = m[3].trim().replace(/\s{2,}/g, " ");
    if (label.length > 30) label = label.slice(0, 28) + "…";
    items.push({ num, label });
  }

  if (items.length < 2) return null;

  // Only show buttons for interactive selectors (❯ cursor or "enter to confirm").
  // Plain numbered lists in output are not actionable prompts.
  if (!isSelector) return null;

  const cursorIdx = items.findIndex((i) => i.num === cursorOnNum);
  return items.map((item, idx) => {
    const moves = idx - (cursorIdx >= 0 ? cursorIdx : 0);
    const arrows = moves > 0 ? ARROW_DOWN.repeat(moves) : "";
    return {
      label: item.label,
      data: arrows + ENTER,
      variant: idx === 0 ? ("primary" as const) : ("default" as const),
    };
  });
}

export function computeMacros(
  status: string | undefined,
  currentTool: string | undefined,
  toolInput: any,
  tailText: string,
): { macros: Macro[]; context?: string } {
  if (status === "waiting_input" && currentTool) {
    if (currentTool === "AskUserQuestion" && toolInput?.questions?.[0]?.options) {
      const options = toolInput.questions[0].options as { label: string }[];
      const macros: Macro[] = options.map((opt, i) => ({
        label: opt.label,
        data: `${i + 1}\r`,
        variant: i === 0 ? "primary" as const : "default" as const,
      }));
      return { macros, context: "Question" };
    }
    return {
      macros: [
        { label: "Allow", data: "\r", variant: "primary" },
        { label: "Deny", data: "\x1b", variant: "danger" },
      ],
      context: `Permission: ${currentTool}`,
    };
  }

  if (status === "running") {
    return {
      macros: [{ label: "Interrupt", data: "\x03", variant: "danger" }],
    };
  }

  if (tailText) {
    const parsed = parseNumberedOptions(tailText);
    if (parsed) {
      return { macros: parsed, context: "Choose" };
    }
  }

  if (status === "waiting_input" || status === "idle") {
    return { macros: [] };
  }

  return { macros: FALLBACK_MACROS };
}
