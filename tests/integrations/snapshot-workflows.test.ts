import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const playerWorkflow = readFileSync(
  resolve(".github/workflows/refresh-sleeper-players.yml"),
  "utf8",
);
const projectionWorkflow = readFileSync(
  resolve(".github/workflows/refresh-projections.yml"),
  "utf8",
);

describe("snapshot refresh workflows", () => {
  it("serializes repository snapshot updates without cancelling queued runs", () => {
    for (const workflow of [playerWorkflow, projectionWorkflow]) {
      expect(workflow).toContain(
        "group: repository-snapshot-refresh-${{ github.repository }}",
      );
      expect(workflow).toContain("cancel-in-progress: false");
      expect(workflow.indexOf("concurrency:")).toBeLessThan(
        workflow.indexOf("jobs:"),
      );
    }
  });

  it("stages projection refreshes after the player refresh schedule", () => {
    expect(playerWorkflow).toContain('cron: "17 9');
    expect(projectionWorkflow).toContain('cron: "47 9');
    expect(projectionWorkflow).not.toContain('cron: "17 9');
  });
});
