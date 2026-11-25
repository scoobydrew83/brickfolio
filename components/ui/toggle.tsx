"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Restyled to Brickfolio's tokens (docs/design.md): the selection is Brick Yellow, the focus ring is the global one in
// app/globals.css, no ring shadow or transition-all. Sizes are padding, as Button's are.
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1.5 rounded-control text-sm whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-primary aria-pressed:font-medium aria-pressed:text-on-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-line-strong bg-surface",
      },
      size: {
        default: "px-3 py-1.5",
        sm: "px-2.5 py-1 text-xs",
        lg: "px-4 py-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
