export interface PlanTask {
  index: number;
  title: string;
  description: string;
}

/**
 * Tries to extract a task index and title from an h2 heading line.
 *
 * Supported formats:
 *   - `## 1. Title`              → index 1, title "Title"
 *   - `## Phase 1: Title`        → index 1, title "Title"
 *   - `## Phase 1 — Title`       → index 1, title "Title"
 *   - `## Step 1: Title`         → index 1, title "Title"
 *   - `## Step 1 — Title`        → index 1, title "Title"
 *
 * Returns `null` if the line doesn't match any known pattern.
 */
function matchNumberedHeading(line: string): { index: number; title: string } | null {
  // ## 1. Title
  const dotMatch = line.match(/^##\s+(\d+)\.\s+(.+)$/);
  if (dotMatch) {
    return { index: parseInt(dotMatch[1], 10), title: dotMatch[2].trim() };
  }

  // ## Phase 1: Title  /  ## Phase 1 — Title  /  ## Step 1: Title  /  ## Step 1 — Title
  const labelledMatch = line.match(/^##\s+(?:Phase|Step)\s+(\d+)[\s]*[:—–\-]\s*(.+)$/i);
  if (labelledMatch) {
    return { index: parseInt(labelledMatch[1], 10), title: labelledMatch[2].trim() };
  }

  return null;
}

/**
 * Parses a markdown plan file into an ordered list of tasks.
 *
 * Tasks are identified by numbered h2 headings in several common formats
 * (see `matchNumberedHeading`). The description is the body text under each
 * heading until the next heading. Unnumbered h2 headings are skipped.
 *
 * Any content before the first numbered heading (e.g. TL;DR, Decisions) is
 * captured as preamble context and prepended to every task's description so
 * that each task is self-contained when sent on to GitHub.
 */
export function parsePlan(markdown: string): PlanTask[] {
  const tasks: PlanTask[] = [];

  // Split into lines for processing
  const lines = markdown.split(/\r?\n/);

  // --- First pass: collect preamble (everything before the first numbered heading) ---
  const preambleLines: string[] = [];
  let firstTaskLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (matchNumberedHeading(lines[i])) {
      firstTaskLineIndex = i;
      break;
    }
    // Skip the top-level h1 title — it's redundant as context
    if (/^#\s/.test(lines[i])) {
      continue;
    }
    preambleLines.push(lines[i]);
  }

  const preamble = preambleLines
    .join("\n")
    .replace(/^\n+|\n+$/g, "")
    .replace(/^---+$/gm, "") // strip horizontal rules
    .replace(/^\n+|\n+$/g, "")
    .trimEnd();

  // --- Second pass: parse numbered tasks ---
  const taskLines = firstTaskLineIndex >= 0 ? lines.slice(firstTaskLineIndex) : [];

  let currentTask: PlanTask | null = null;
  const descriptionLines: string[] = [];

  const flushCurrent = () => {
    if (currentTask !== null) {
      const body = descriptionLines
        .join("\n")
        .replace(/^\n+|\n+$/g, "")
        .trimEnd();

      currentTask.description = preamble
        ? preamble + "\n\n---\n\n" + body
        : body;

      tasks.push(currentTask);
    }
  };

  for (const line of taskLines) {
    const headingMatch = matchNumberedHeading(line);

    if (headingMatch) {
      // Save the previous task before starting a new one
      flushCurrent();
      descriptionLines.length = 0;

      currentTask = {
        index: headingMatch.index,
        title: headingMatch.title,
        description: "",
      };
    } else if (/^#{1,6}\s/.test(line)) {
      // Any other heading level terminates the current task description
      // (but we don't start a new task)
      flushCurrent();
      descriptionLines.length = 0;
      currentTask = null;
    } else if (currentTask !== null) {
      descriptionLines.push(line);
    }
  }

  // Flush the last task
  flushCurrent();

  // Sort by task index to guarantee order
  tasks.sort((a, b) => a.index - b.index);

  return tasks;
}
