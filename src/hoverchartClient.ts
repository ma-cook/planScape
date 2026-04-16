import * as vscode from "vscode";
import { PlanTask } from "./planParser.js";
import { getUserId } from "./auth.js";
import { getConfig } from "./config.js";
import { BULK_IMPORT_URL, FIREBASE_PROJECT_ID } from "./constants.js";

/**
 * The shape of a single TextObject as expected by the bulkImport Cloud Function.
 * Styling and positioning are handled by the hoverchart application.
 */
interface TextObject {
  id: string;
  type: string;
  content: string;
  createdAt: number;
  headerText?: string;
  merfolkData?: object;
}

/**
 * Request body sent to the bulkImport Cloud Function.
 */
interface BulkImportRequest {
  idToken: string;
  userId: string;
  spaceId: string;
  objects: TextObject[];
  connections: unknown[];
}

/**
 * Result of a space access validation check.
 */
export interface SpaceAccessResult {
  valid: boolean;
  spaceName: string | undefined;
  isOwner: boolean;
}

/**
 * Validates that the target space exists and the authenticated user has write
 * access, using a pre-flight read against the Firestore REST API.
 *
 * Returns:
 *   - `valid`     – whether the user may write to the space
 *   - `spaceName` – human-readable name extracted from the space document
 *   - `isOwner`   – whether the logged-in user owns the space
 */
export async function validateSpaceAccess(
  idToken: string,
  userId: string,
  spaceOwnerId: string,
  spaceId: string
): Promise<SpaceAccessResult> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents` +
    `/users/${spaceOwnerId}/spaces/${spaceId}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
  } catch {
    return { valid: false, spaceName: undefined, isOwner: false };
  }

  if (!res.ok) {
    return { valid: false, spaceName: undefined, isOwner: false };
  }

  const doc = (await res.json()) as {
    fields?: {
      name?: { stringValue?: string };
      ownerId?: { stringValue?: string };
      sharedWith?: {
        arrayValue?: {
          values?: Array<{
            mapValue?: {
              fields?: { userId?: { stringValue?: string } };
            };
          }>;
        };
      };
    };
  };

  const spaceName = doc.fields?.name?.stringValue;
  const ownerId = doc.fields?.ownerId?.stringValue;
  const isOwner = ownerId === userId;

  if (isOwner) {
    return { valid: true, spaceName, isOwner: true };
  }

  // Check whether the user appears in the sharedWith array
  const sharedWith = doc.fields?.sharedWith?.arrayValue?.values ?? [];
  const hasAccess = sharedWith.some(
    (entry) => entry.mapValue?.fields?.userId?.stringValue === userId
  );

  return { valid: hasAccess, spaceName, isOwner: false };
}

/**
 * Converts an ordered list of PlanTasks into TextObjects and POSTs them to
 * the hoverchart bulkImport Cloud Function.
 *
 * Before exporting:
 *   1. Reads config from `.github/hoverchart.json` or VS Code settings.
 *   2. Validates the target space exists and the user has access.
 *   3. Warns the user if the logged-in account differs from the space owner.
 */
export async function exportTasks(
  context: vscode.ExtensionContext,
  tasks: PlanTask[],
  idToken: string
): Promise<void> {
  const cfg = getConfig();
  if (!cfg) {
    throw new Error(
      "Hoverchart is not configured. Run 'Hoverchart: Configure' to set up the target space."
    );
  }

  const { spaceId, spaceOwnerId } = cfg;
  const userId = await getUserId(context);

  if (!userId) {
    throw new Error("Not logged in. Please run 'Hoverchart: Login' first.");
  }

  // Pre-flight: verify the space exists and the user can write to it
  const access = await validateSpaceAccess(idToken, userId, spaceOwnerId, spaceId);
  if (!access.valid) {
    throw new Error(
      `Cannot access hoverchart space "${spaceId}" owned by "${spaceOwnerId}". ` +
        "The space may not exist, or you may not have write access."
    );
  }

  // Warn when the logged-in user is not the space owner
  if (spaceOwnerId !== userId) {
    const warning = await vscode.window.showWarningMessage(
      `You are logged in as ${userId} but the target space is owned by ${spaceOwnerId}. Continue?`,
      "Yes",
      "Re-configure",
      "Cancel"
    );
    if (warning === "Re-configure") {
      await vscode.commands.executeCommand("hoverchart.configure");
      return;
    }
    if (warning !== "Yes") {
      return;
    }
  }

  // Scope object IDs to the workspace to prevent cross-project collisions
  const workspaceFolderName =
    vscode.workspace.workspaceFolders?.[0]?.name ?? "workspace";

  const objects: TextObject[] = tasks.map((task) => ({
    id: `plan-${workspaceFolderName}-task-${task.index}`,
    type: "text",
    content: task.description,
    createdAt: Date.now(),
    headerText: `${task.index}. ${task.title}`,
    merfolkData: {
      planTaskIndex: task.index,
      status: "queued",
      githubIssueNumber: null,
      githubPrNumber: null,
    },
  }));

  const body: BulkImportRequest = {
    idToken,
    userId,
    spaceId,
    objects,
    connections: [],
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
    throw new Error(`bulkImport request failed (${response.status}): ${text}`);
  }
}
