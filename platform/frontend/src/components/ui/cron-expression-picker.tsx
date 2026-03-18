"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCronSchedule } from "@/lib/format-cron";

export type CronPresetOption = {
  label: string;
  value: string;
};

export const DEFAULT_CRON_PRESET_OPTIONS: CronPresetOption[] = [
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Daily", value: "0 0 * * *" },
  { label: "Weekly", value: "0 0 * * 0" },
];

const CUSTOM_VALUE = "__custom__";

export function CronExpressionPicker({
  value,
  onChange,
  presets = DEFAULT_CRON_PRESET_OPTIONS,
  selectPlaceholder = "Select a schedule",
  customPlaceholder = "0 */6 * * *",
  descriptionFallback = "Enter a 5-field cron expression.",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  presets?: CronPresetOption[];
  selectPlaceholder?: string;
  customPlaceholder?: string;
  descriptionFallback?: string;
  className?: string;
}) {
  const presetValues = useMemo(
    () => new Set(presets.map((preset) => preset.value)),
    [presets],
  );
  const [isCustom, setIsCustom] = useState(!!value && !presetValues.has(value));

  useEffect(() => {
    if (!value) {
      return;
    }

    setIsCustom(!presetValues.has(value));
  }, [presetValues, value]);

  const humanReadable = useMemo(() => {
    if (!value) {
      return null;
    }

    const result = formatCronSchedule(value);
    return result !== value ? result : null;
  }, [value]);

  return (
    <div className={className}>
      <div className="space-y-2">
        <Select
          value={isCustom ? CUSTOM_VALUE : value}
          onValueChange={(nextValue) => {
            if (nextValue === CUSTOM_VALUE) {
              setIsCustom(true);
              return;
            }

            setIsCustom(false);
            onChange(nextValue);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_VALUE}>Custom</SelectItem>
          </SelectContent>
        </Select>

        {isCustom && (
          <Input
            placeholder={customPlaceholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}

        <p className="text-xs text-muted-foreground">
          {humanReadable ?? descriptionFallback}
        </p>
      </div>
    </div>
  );
}
