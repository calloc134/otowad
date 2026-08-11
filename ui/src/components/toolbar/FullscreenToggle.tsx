import { Maximize2, Minimize2 } from "lucide-react";
import { css } from "../../../styled-system/css";
import { IconButton } from "@/design-system/index.ts";
import { useFullscreen } from "@/hooks/useFullscreen.ts";

/**
 * Fullscreen toggle for the workspace.
 *
 * Renders nothing where element fullscreen does not exist — notably iPhone
 * Safari, which only ever goes fullscreen for `<video>`. A button that quietly
 * did nothing on a phone would be worse than no button, and the honest route
 * there is installing the app to the home screen, which the manifest covers.
 */
export function FullscreenToggle() {
  const { supported, active, toggle } = useFullscreen();

  if (!supported) {
    return null;
  }

  const label = active ? "Exit fullscreen" : "Enter fullscreen";

  return (
    <IconButton
      onClick={toggle}
      className={iconButtonClass}
      title={label}
      aria-label={label}
      aria-pressed={active}
      data-testid="fullscreen-toggle"
    >
      {active ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </IconButton>
  );
}

const iconButtonClass = css({
  width: "36px",
  height: "36px",
});
