import type { APIRequestContext } from "@playwright/test";
import { API_BASE_URL } from "../../consts";
import { expect, goToPage, test } from "../../fixtures";

async function apiRequest<T>({
  request,
  method,
  path,
  data,
}: {
  request: APIRequestContext;
  method: "post" | "delete";
  path: string;
  data?: unknown;
}): Promise<T> {
  const response = await request[method](`${API_BASE_URL}${path}`, {
    ...(data !== undefined ? { data } : {}),
    headers: {
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      Origin: "http://localhost:3000",
    },
  });

  if (!response.ok()) {
    throw new Error(
      `Failed to ${method.toUpperCase()} ${path}: ${response.status()} ${await response.text()}`,
    );
  }

  return (await response.json()) as T;
}

test.describe("Schedule Triggers", () => {
  test("can edit a trigger and preserve run history when collapsing the accordion", async ({
    page,
    request,
    makeRandomString,
  }) => {
    const agentName = makeRandomString(8, "Schedule Agent");
    const triggerName = makeRandomString(8, "Schedule Trigger");
    const initialMessage = "Initial schedule prompt";
    const updatedMessage = "Updated schedule prompt";

    let agentId: string | null = null;
    let triggerId: string | null = null;

    try {
      const agent = await apiRequest<{ id: string }>({
        request,
        method: "post",
        path: "/api/agents",
        data: {
          name: agentName,
          agentType: "agent",
          scope: "org",
          teams: [],
        },
      });
      agentId = agent.id;

      const trigger = await apiRequest<{ id: string }>({
        request,
        method: "post",
        path: "/api/schedule-triggers",
        data: {
          name: triggerName,
          agentId,
          cronExpression: "0 9 * * 1-5",
          timezone: "UTC",
          messageTemplate: initialMessage,
        },
      });
      triggerId = trigger.id;

      await apiRequest({
        request,
        method: "post",
        path: `/api/schedule-triggers/${triggerId}/run-now`,
      });

      await goToPage(page, "/agents/triggers/schedule");

      const triggerCard = page
        .locator('[data-slot="card"]')
        .filter({ has: page.getByText(triggerName, { exact: true }) });

      await expect(triggerCard).toHaveCount(1);
      await expect(triggerCard.getByText(initialMessage)).toBeVisible();

      await triggerCard.getByRole("button", { name: "Edit" }).click();

      const editDialog = page.getByRole("dialog", {
        name: "Edit Schedule Trigger",
      });
      await expect(editDialog).toBeVisible();
      await editDialog.getByLabel("Message template").fill(updatedMessage);
      await editDialog.getByRole("button", { name: "Save Changes" }).click();

      await expect(editDialog).not.toBeVisible({ timeout: 15_000 });
      await expect(triggerCard.getByText(updatedMessage)).toBeVisible({
        timeout: 15_000,
      });

      const historyToggle = triggerCard.getByRole("button", {
        name: "Run history",
      });
      await historyToggle.click();

      const historyRegion = triggerCard.getByRole("region", {
        name: "Run history",
      });
      await expect(historyRegion.getByRole("button").first()).toBeVisible({
        timeout: 15_000,
      });

      await historyRegion.getByRole("button").first().click();

      const runDialog = page.getByRole("dialog", {
        name: "Run details",
      });
      await expect(runDialog).toBeVisible();
      await expect(runDialog.getByText("Prompt snapshot")).toBeVisible();
      await runDialog.getByRole("button", { name: "Close" }).first().click();
      await expect(runDialog).not.toBeVisible();

      await historyToggle.press("Enter");
      await expect(
        triggerCard.getByText("No runs recorded yet."),
      ).toHaveCount(0);
    } finally {
      if (triggerId) {
        await apiRequest({
          request,
          method: "delete",
          path: `/api/schedule-triggers/${triggerId}`,
        }).catch(() => undefined);
      }

      if (agentId) {
        await apiRequest({
          request,
          method: "delete",
          path: `/api/agents/${agentId}`,
        }).catch(() => undefined);
      }
    }
  });
});
