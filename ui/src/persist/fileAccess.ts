// =============================================================================
// File System Access API wrapper with fallback for non-Chromium browsers
// =============================================================================

const ZIP_FILE_TYPE_OPTION: FilePickerAcceptType = {
  description: "DAW Project Archive",
  accept: { "application/zip": [".zip"] },
};

const JSON_FILE_TYPE_OPTION: FilePickerAcceptType = {
  description: "DAW Project JSON",
  accept: { "application/json": [".json"] },
};

export interface SavedProjectFile {
  handle: FileSystemFileHandle | null;
  fileName: string;
}

export interface OpenedProjectFile {
  file: File;
  handle: FileSystemFileHandle | null;
  fileName: string;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function hasFileSystemAccess(): boolean {
  return "showSaveFilePicker" in window && "showOpenFilePicker" in window;
}

// ---------------------------------------------------------------------------
// Native File System Access API paths
// ---------------------------------------------------------------------------

async function nativeSave(
  fileBlob: Blob,
  handle: FileSystemFileHandle,
): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(fileBlob);
  await writable.close();
}

async function nativeSaveAs(
  fileBlob: Blob,
  suggestedName: string,
): Promise<SavedProjectFile | null> {
  try {
    const handle = await window.showSaveFilePicker({
      types: [ZIP_FILE_TYPE_OPTION],
      suggestedName,
    });
    await nativeSave(fileBlob, handle);
    return {
      handle,
      fileName: handle.name,
    };
  } catch (e) {
    // User cancelled the dialog
    if (e instanceof DOMException && e.name === "AbortError") {
      return null;
    }
    throw e;
  }
}

async function nativeOpen(): Promise<{
  file: File;
  handle: FileSystemFileHandle | null;
  fileName: string;
} | null> {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [ZIP_FILE_TYPE_OPTION, JSON_FILE_TYPE_OPTION],
      multiple: false,
    });
    if (!handle) return null;
    const file = await handle.getFile();
    return {
      file,
      handle,
      fileName: file.name,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return null;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Fallback paths (Firefox / Safari)
// ---------------------------------------------------------------------------

function fallbackSave(fileBlob: Blob, fileName: string): void {
  const url = URL.createObjectURL(fileBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fallbackOpen(): Promise<{ file: File; fileName: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip,.json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ file, fileName: file.name });
    });
    input.addEventListener("cancel", () => {
      resolve(null);
    });
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save a project archive to a file.
 *
 * - If `existingHandle` is provided, writes directly to that file.
 * - Otherwise, shows a save dialog (or triggers download in fallback browsers).
 *
 * Returns the saved handle and file name, or `null` if the user cancels.
 */
export async function saveProjectToFile(
  fileBlob: Blob,
  fileName: string,
  existingHandle?: FileSystemFileHandle,
): Promise<SavedProjectFile | null> {
  if (hasFileSystemAccess()) {
    if (existingHandle) {
      await nativeSave(fileBlob, existingHandle);
      return {
        handle: existingHandle,
        fileName: existingHandle.name,
      };
    }
    return nativeSaveAs(fileBlob, fileName);
  }

  // Fallback: trigger download
  fallbackSave(fileBlob, fileName);
  return {
    handle: null,
    fileName,
  };
}

/**
 * Open a project file.
 *
 * Shows a file open dialog and returns the selected file plus its handle when
 * available. The caller decides how to decode the file contents.
 *
 * Returns `null` if the user cancels.
 */
export async function openProjectFile(): Promise<OpenedProjectFile | null> {
  if (hasFileSystemAccess()) {
    return nativeOpen();
  }

  const result = await fallbackOpen();
  if (!result) return null;
  return {
    file: result.file,
    handle: null,
    fileName: result.fileName,
  };
}

/**
 * Save As — always shows a save dialog.
 *
 * Returns the new file metadata, or `null` if the user cancels.
 */
export async function saveProjectAs(
  fileBlob: Blob,
  fileName: string,
): Promise<SavedProjectFile | null> {
  if (hasFileSystemAccess()) {
    return nativeSaveAs(fileBlob, fileName);
  }

  fallbackSave(fileBlob, fileName);
  return {
    handle: null,
    fileName,
  };
}
