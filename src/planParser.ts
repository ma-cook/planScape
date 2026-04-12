export interface PlanTask {
  index: number;
  title: string;
  description: string;
}

/**
 * Parses a markdown plan file into an ordered list of tasks.
 *
 * Tasks are identified by `## N. Title` headings (h2 with a numeric prefix).
 * The description is the body text under each heading until the next heading.
 * Unnumbered h2 headings are skipped.
 */
export function parsePlan(markdown: string): PlanTask[] {
  const tasks: PlanTask[] = [];

  // Split into lines for processing
  const lines = markdown.split(/\r?\n/);

  // Regex to match numbered h2 headings: ## 1. Title
  const numberedHeadingRe = /^##\s+(\d+)\.\s+(.+)$/;

  let currentTask: PlanTask | null = null;
  const descriptionLines: string[] = [];

  const flushCurrent = () => {
    if (currentTask !== null) {
      currentTask.description = descriptionLines
        .join("\n")
        .replace(/^\n+|\n+$/g, "") // trim leading/trailing blank lines
        .trimEnd();
      tasks.push(currentTask);
    }
  };

  for (const line of lines) {
    const headingMatch = line.match(numberedHeadingRe);

    if (headingMatch) {
      // Save the previous task before starting a new one
      flushCurrent();
      descriptionLines.length = 0;

      currentTask = {
        index: parseInt(headingMatch[1], 10),
        title: headingMatch[2].trim(),
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
