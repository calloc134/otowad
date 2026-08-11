/**
 * jsdom reports a 1024x768 viewport, which the app classifies as a tablet.
 * Tests that mean "a phone" have to say so: a coarse pointer on its own no
 * longer selects the mobile shell, because a tablet has one too.
 */
export function setPhoneViewport(orientation: "portrait" | "landscape" = "landscape"): void {
  const [width, height] = orientation === "portrait" ? [390, 844] : [844, 390];
  setViewportSize(width, height);
}

export function setViewportSize(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}
