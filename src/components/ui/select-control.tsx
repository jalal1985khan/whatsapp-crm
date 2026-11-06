"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const EMPTY_VALUE = "__crm_select_empty__";

type OptionProps = { value?: string; disabled?: boolean; children?: React.ReactNode };
type SelectControlProps = {
  children?: React.ReactNode;
  value?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  onChange?: React.ChangeEventHandler<HTMLSelectElement>;
};

/** Compatibility wrapper that keeps simple option lists while rendering the shadcn Select primitive. */
export function SelectControl({ children, value, onChange, className, disabled, ...triggerProps }: SelectControlProps) {
  const options = React.Children.toArray(children).filter(React.isValidElement) as React.ReactElement<OptionProps>[];
  const emptyOption = options.find((option) => (option.props.value ?? "") === "");
  return (
    <SelectPrimitive.Root value={value === "" || value == null ? EMPTY_VALUE : String(value)} onValueChange={(next) => onChange?.({ target: { value: next === EMPTY_VALUE ? "" : next } } as React.ChangeEvent<HTMLSelectElement>)} disabled={disabled}>
      <SelectPrimitive.Trigger {...triggerProps} className={cn("flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)}>
        <SelectPrimitive.Value placeholder={emptyOption?.props.children ?? "Choose an option"} />
        <SelectPrimitive.Icon asChild><ChevronDown className="size-4 opacity-50" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2">
          <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1"><ChevronUp className="size-4" /></SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {emptyOption && <SelectPrimitive.Item value={EMPTY_VALUE} className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><span className="absolute left-2 flex size-3.5 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{emptyOption.props.children}</SelectPrimitive.ItemText></SelectPrimitive.Item>}
            {options.filter((option) => (option.props.value ?? "") !== "").map((option, index) => <SelectPrimitive.Item key={option.key ?? `${option.props.value}-${index}`} value={option.props.value ?? String(index)} disabled={option.props.disabled} className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"><span className="absolute left-2 flex size-3.5 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{option.props.children}</SelectPrimitive.ItemText></SelectPrimitive.Item>)}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1"><ChevronDown className="size-4" /></SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
