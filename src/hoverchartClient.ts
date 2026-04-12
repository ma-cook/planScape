import * as vscode from "vscode";
import { PlanTask } from "./planParser.js";

const BULK_IMPORT_URL = "https://bulkimport-qtk2xsi74a-uc.a.run.app";

/**
 * The shape of a single TextObject as expected by the bulkImport Cloud Function.
 */
interface TextObject {
  type: "TextObject";
  text: string;
  description: string;
  position: { x: number; y: number; z: number };
  index: number;
}

/**
 * Request body sent to the bulkImport Cloud Function.
 */
interface BulkImportRequest {
  idToken: string;
  spaceId: string;
  spaceOwnerId: string;
  objects: TextObject[];
}

/**
 * Converts an ordered list of PlanTasks into TextObjects arranged in a 3D
 * pipeline along the X axis and POSTs them to the hoverchart bulkImport Cloud
 * Function.
 */
export async function exportTasks(
  context: vscode.ExtensionContext,
  tasks: PlanTask[],
  idToken: string
): Promise<void> {
  const config = vscode.workspace.getConfiguration("hoverchart");
  const spaceId = config.get<string>("spaceId") ?? "";
  const spaceOwnerId = config.get<string>("spaceOwnerId") ?? "";

  if (!spaceId || !spaceOwnerId) {
    throw new Error(
      "hoverchart.spaceId and hoverchart.spaceOwnerId must be set in VS Code settings."
    );
  }

  // Arrange tasks in a 3D pipeline along the X axis with consistent spacing
  const SPACING_X = 3;

  const objects: TextObject[] = tasks.map((task, arrayIndex) => ({
    type: "TextObject",
    text: `${task.index}. ${task.title}`,
    description: task.description,
    position: {
      x: arrayIndex * SPACING_X,
      y: 0,
      z: 0,
    },
    index: task.index,
  }));

  const body: BulkImportRequest = {
    idToken,
    spaceId,
    spaceOwnerId,
    objects,
  };

  const response = await fetch(BULK_IMPORT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `bulkImport request failed (${response.status}): ${text}`
    );
  }
}
