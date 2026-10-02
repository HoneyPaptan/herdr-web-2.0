import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const PHONE_SHEET = "max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[max(1.25rem,env(safe-area-inset-top))] max-md:pb-[max(1.25rem,env(safe-area-inset-bottom))]"

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0", className)}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  closeLabel,
  phoneSheet = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string; phoneSheet?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-phone-sheet={phoneSheet || undefined}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-100 -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-popover backdrop-blur-xl p-5 text-popover-foreground shadow-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          phoneSheet && PHONE_SHEET,
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          aria-label={closeLabel}
          className="absolute top-5 right-5 cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 max-md:top-[max(1.25rem,env(safe-area-inset-top))]"
        >
          <XIcon className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-ui font-medium", className)} {...props} />
}

export { Dialog, DialogContent, DialogOverlay, DialogTitle }
