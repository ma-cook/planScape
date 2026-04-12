# PlanScape

VS Code extension that watches for plan files, parses them into ordered tasks, and exports them to a [Hoverchart](https://hoverchart.com) space.

## Prerequisites

- VS Code 1.85.0 or later
- A Hoverchart account with access to the target space

## Getting Started

### 1. Install the Extension

Build and install the extension from source:

```sh
npm install
npm run compile
npm run package
```

Then install the generated `.vsix` file via **Extensions → ··· → Install from VSIX…**

### 2. Log In

Open the Command Palette (`Ctrl+Shift+P`) and run:

```
Hoverchart: Login
```

This opens a browser window for Google sign-in. After authenticating, you can close the browser tab.

### 3. Configure the Target Space

Run the command:

```
Hoverchart: Configure
```

You will be prompted for:

| Field | Description |
|---|---|
| **Space ID** | The ID of the Hoverchart space to export tasks to |
| **Space Owner ID** | The Firebase UID of the space owner |
| **Space Name** *(optional)* | A human-readable label for the space |

The configuration is saved to `.github/hoverchart.json` in your workspace root. You can also set `hoverchart.spaceId` and `hoverchart.spaceOwnerId` in VS Code settings as a fallback.

## Writing a Plan File

Create a file at `.github/plan.md` in your workspace. Tasks are defined as numbered `##` headings in any of these formats:

```markdown
## 1. Set up the database
## Phase 1: Set up the database
## Phase 1 — Set up the database
## Step 1: Set up the database
```

Full example:

```markdown
## 1. Set up the database

Create the PostgreSQL schema and seed initial data.

## 2. Build the API layer

Implement REST endpoints for the core resources.

## 3. Add authentication

Integrate OAuth2 login and protect routes.
```

Or using the phase style that Copilot commonly generates:

```markdown
## Phase 1: Set up the database

Create the PostgreSQL schema and seed initial data.

## Phase 2: Build the API layer

Implement REST endpoints for the core resources.
```

Each task consists of a **numbered heading** and the **body text** beneath it (up to the next heading). Unnumbered `##` headings (like `## TL;DR` or `## Decisions`) are ignored.

## Exporting Tasks

### Automatic Export

The extension watches `.github/plan.md` for changes. When the file is created or modified, you'll be prompted to export the parsed tasks to your configured Hoverchart space.

### Manual Export

Open the Command Palette and run:

```
Hoverchart: Export Plan
```

This reads `.github/plan.md`, parses the tasks, and exports them to the configured space after a confirmation prompt.

## Commands

| Command | Description |
|---|---|
| `Hoverchart: Login` | Authenticate with your Google account |
| `Hoverchart: Configure` | Set the target Hoverchart space |
| `Hoverchart: Export Plan` | Manually export tasks from `.github/plan.md` |

## Settings

| Setting | Description |
|---|---|
| `hoverchart.spaceId` | The Hoverchart space ID (fallback if `.github/hoverchart.json` is absent) |
| `hoverchart.spaceOwnerId` | The Firebase UID of the space owner (fallback) |
