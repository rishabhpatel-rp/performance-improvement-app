import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "success" | "destructive" | "outline" | "secondary";

const variantClasses: Record<Variant, string> = {
  default: "bg-primary text-primary-foreground",
  success: "bg-green-100 text-green-800 border border-green-200",
  destructive: "bg-red-100 text-red-800 border border-red-200",
  outline: "border border-border text-foreground",
  secondary: "bg-secondary text-secondary-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
