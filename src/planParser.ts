export interface PlanTask {
  index: number;
  title: string;
  description: string;
}

/**
 * Tries to match a phase heading (h2) with a number.
 *
 * Supported formats:
 *   - `## 1. Title`              → index 1, title "Title"
 *   - `## Phase 1: Title`        → index 1, title "Title"
 *   - `## Phase 1 — Title`       → index 1, title "Title"
 *
 * Returns `null` if the line doesn't match.
 */
function matchPhaseHeading(line: string): { index: number; title: string } | null {
  const dotMatch = line.match(/^##\s+(\d+)\.\s+(.+)$/);
  if (dotMatch) {
    return { index: parseInt(dotMatch[1], 10), title: dotMatch[2].trim() };
  }

  const labelledMatch = line.match(/^##\s+(?:Phase)\s+(\d+)[\s]*[:—–\-]\s*(.+)$/i);
  if (labelledMatch) {
    return { index: parseInt(labelledMatch[1], 10), title: labelledMatch[2].trim() };
  }

  return null;
}

/**
 * Matches the `## Verification` heading (case-insensitive).
 */
function isVerificationHeading(line: string): boolean {
  return /^##\s+Verification\s*$/i.test(line);
}

/**
 * Parses a markdown plan file into an ordered list of tasks.
 *
 * Each numbered phase (h2) becomes a task whose title is the phase name.
 * Everything under that phase — including h3 step headings, body text, and
 * bullet points — forms the task description.
 *
 * The Verification section (if present) is appended to the final task's
 * description so that the last task carries the acceptance criteria.
 *
 * Non-phase h2 sections (e.g. Relevant Files, Decisions) are ignored.
 */
export function parsePlan(markdown: string): PlanTask[] {
  const tasks: PlanTask[] = [];
  const lines = markdown.split(/\r?\n/);

  let currentTask: PlanTask | null = null;
  let descriptionLines: string[] = [];
  let verificationLines: string[] = [];
  let inVerification = false;

  const flushCurrent = () => {
    if (currentTask !== null) {
      currentTask.description = descriptionLines
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
        .trimEnd();
      tasks.push(currentTask);
      currentTask = null;
      descriptionLines = [];
    }
  };

  for (const line of lines) {
    // Check for h2 headings — they delimit phases and special sections
    if (/^##\s/.test(line)) {
      // End any in-progress phase or verification section
      if (inVerification) {
        inVerification = false;
      } else {
        flushCurrent();
      }

      if (isVerificationHeading(line)) {
        inVerification = true;
        verificationLines = [];
        continue;
      }

      const phaseMatch = matchPhaseHeading(line);
      if (phaseMatch) {
        currentTask = {
          index: phaseMatch.index,
          title: phaseMatch.title,
          description: "",
        };
        descriptionLines = [];
      }
      // Non-phase, non-verification h2s (Relevant Files, Decisions, etc.) are ignored
      continue;
    }

    if (inVerification) {
      verificationLines.push(line);
    } else if (currentTask !== null) {
      descriptionLines.push(line);
    }
  }

  // Flush the last phase
  flushCurrent();

  // Sort by phase index
  tasks.sort((a, b) => a.index - b.index);

  // Append verification section to the final task
  if (tasks.length > 0 && verificationLines.length > 0) {
    const verification = verificationLines
      .join("\n")
      .replace(/^\n+|\n+$/g, "")
      .trimEnd();
    if (verification) {
      const last = tasks[tasks.length - 1];
      last.description = last.description
        ? last.description + "\n\n---\n\n## Verification\n\n" + verification
        : "## Verification\n\n" + verification;
    }
  }

  return tasks;
}
