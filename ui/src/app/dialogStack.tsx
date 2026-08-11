import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Tracks how many dialogs are currently open.
 *
 * The previous check asked the DOM for `.dialog-backdrop`, a class nothing
 * renders — PandaCSS emits hashed atomic class names, so a hand-written
 * selector could never match. It therefore reported "no dialog open" always.
 *
 * A DOM query could not have worked here regardless: the open state for five
 * of the dialogs lives in `Toolbar`'s local `useState`, so a counter that
 * dialogs register with themselves is the only thing that sees all of them.
 */

interface DialogStackValue {
  openCount: number;
  registerOpenDialog: () => () => void;
}

const DialogStackContext = createContext<DialogStackValue>({
  openCount: 0,
  registerOpenDialog: () => () => {},
});

export function DialogStackProvider({ children }: { children: ReactNode }) {
  const [openCount, setOpenCount] = useState(0);

  const registerOpenDialog = useCallback(() => {
    setOpenCount((count) => count + 1);
    let released = false;
    return () => {
      // Guard against a double release: React 19 StrictMode runs effect
      // cleanup twice in development, which would drive the count negative.
      if (released) return;
      released = true;
      setOpenCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const value = useMemo(
    () => ({ openCount, registerOpenDialog }),
    [openCount, registerOpenDialog],
  );

  return (
    <DialogStackContext.Provider value={value}>{children}</DialogStackContext.Provider>
  );
}

/** True while at least one dialog is open. */
export function useAnyDialogOpen(): boolean {
  return useContext(DialogStackContext).openCount > 0;
}

/** Registers a dialog with the stack for as long as `open` stays true. */
export function useRegisterOpenDialog(open: boolean): void {
  const { registerOpenDialog } = useContext(DialogStackContext);

  useEffect(() => {
    if (!open) return;
    return registerOpenDialog();
  }, [open, registerOpenDialog]);
}
