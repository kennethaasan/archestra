import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CronExpressionPicker } from "./cron-expression-picker";

describe("CronExpressionPicker", () => {
  it("shows the preset label on the trigger for preset values", () => {
    render(<CronExpressionPicker value="0 * * * *" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { expanded: false })).toHaveTextContent(
      "Every hour",
    );
  });

  it("shows the human-readable label on the trigger for custom values", () => {
    render(<CronExpressionPicker value="7 4 * * *" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { expanded: false })).toHaveTextContent(
      "At 04:07",
    );
  });

  it("shows the placeholder when no value is set", () => {
    render(<CronExpressionPicker value="" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { expanded: false })).toHaveTextContent(
      "Select a schedule",
    );
  });
});
