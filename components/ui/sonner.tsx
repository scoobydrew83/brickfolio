"use client"

// Restyled for Brickfolio (docs/design.md): callout white with the 1.5px ink outline, Control radius, the one
// dialog shadow, Archivo, and Brick Yellow only on an action button. Colours are our tokens, so both dark modes
// follow without next-themes. Views use `toast` from '@/components/ui'; the app mounts <ToastHost /> once.
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      // Our tokens set every colour below; the theme only picks sonner's fallbacks, which never show.
      theme="light"
      className="toaster group font-sans!"
      icons={{
        success: <CircleCheckIcon className="size-4 text-ok" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warn" />,
        error: <OctagonXIcon className="size-4 text-danger" />,
        loading: <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" />,
      }}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--fg)",
          "--normal-border": "var(--outline)",
          "--border-radius": "var(--radius-control)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast border-[1.5px]! text-sm! shadow-raised!",
          title: "font-semibold!",
          description: "text-fg-2!",
          actionButton: "rounded-control! bg-primary! font-semibold! text-on-primary! hover:bg-primary-hover!",
          cancelButton: "rounded-control! bg-muted! text-fg!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
