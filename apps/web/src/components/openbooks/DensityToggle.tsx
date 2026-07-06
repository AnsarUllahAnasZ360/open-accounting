"use client";

import { Rows2, Rows3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useDensity } from "./DensityProvider";

/** Toggle between comfortable and compact row density. */
export function DensityToggle() {
  const { density, toggle } = useDensity();
  const compact = density === "compact";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={toggle}
          aria-label={compact ? "Switch to comfortable density" : "Switch to compact density"}
          data-testid="density-toggle"
        >
          {compact ? <Rows2 className="size-4" /> : <Rows3 className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{compact ? "Comfortable rows" : "Compact rows"}</TooltipContent>
    </Tooltip>
  );
}
