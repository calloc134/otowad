import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { css } from "../../../styled-system/css";
import { useRegisterOpenDialog } from "@/app/dialogStack.tsx";
import { useDialogInteractionPolicy } from "@/app/interactionMode.tsx";
import { Dialog } from "@/design-system/index.ts";

interface DialogWrapperProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}

export function DialogWrapper({
  open,
  onClose,
  title,
  children,
  width = 360,
}: DialogWrapperProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const interactionPolicy = useDialogInteractionPolicy();
  const widthValue = typeof width === "number" ? `${width}px` : width;

  // Every dialog in the app renders through this component, so registering
  // here is what makes the whole stack visible to the global hotkey handler.
  useRegisterOpenDialog(open);

  // Escape stays owned here. Both listeners sit on `window`, so
  // stopPropagation would not suppress the global one — instead the global
  // handler checks the dialog stack and steps aside while a dialog is open.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  useEffect(() => {
    if (open && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className={backdropClass} onClick={onClose}>
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <Dialog
          title={title}
          onClose={onClose}
          closeActionSize={interactionPolicy.actionSize}
          className={interactionPolicy.actionSize === "touch" ? dialogShellTouchClass : dialogShellClass}
          style={{ width: `min(calc(100vw - 24px), ${widthValue})` }}
        >
          {children}
        </Dialog>
      </div>
    </div>
  );
}

const dialogShellClass = css({
  maxHeight: "min(92vh, 820px)",
});

const dialogShellTouchClass = css({
  maxHeight: "min(94vh, 900px)",
});

const backdropClass = css({
  position: "fixed",
  inset: "0",
  background:
    "radial-gradient(circle at top, rgba(40,56,112,0.22), transparent 30%), rgba(5, 8, 18, 0.78)",
  backdropFilter: "blur(10px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
});
