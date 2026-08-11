import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAppShellVariant,
  resolveDialogInteractionPolicy,
  resolveInteractionEnvironment,
  resolveInteractionMode,
  resolveLayoutMode,
  isTouchLikeDevice,
  resolveDeviceCapabilities,
  resolveMidiEditorInteractionPolicy,
  resolveTrackListInteractionPolicy,
  resolveTimelineInteractionPolicy,
  shouldShowPortraitGuidance,
} from "./deviceInteraction.ts";

function createEnvironment(args: {
  coarsePointer?: boolean;
  hover?: boolean;
  maxTouchPoints?: number;
  width?: number;
  height?: number;
}) {
  const {
    coarsePointer = false,
    hover = true,
    maxTouchPoints = 0,
    width = 1280,
    height = 720,
  } = args;
  return {
    innerWidth: width,
    innerHeight: height,
    navigator: { maxTouchPoints },
    matchMedia(query: string) {
      return {
        matches:
          query === "(pointer: coarse)"
            ? coarsePointer
            : query === "(hover: hover)"
              ? hover
              : false,
      };
    },
  };
}

test("touch-like capabilities resolve touch interaction policies", () => {
  const capabilities = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 5 }),
  );

  assert.equal(isTouchLikeDevice(capabilities), true);
  assert.equal(resolveTimelineInteractionPolicy(capabilities).allowsModifierShortcuts, false);
  assert.equal(resolveTimelineInteractionPolicy(capabilities).clipActionSize, "touch");
  assert.equal(resolveMidiEditorInteractionPolicy(capabilities).wheelMode, "scroll");
  assert.equal(resolveTrackListInteractionPolicy(capabilities).showsExplicitRenameAction, true);
  assert.equal(resolveDialogInteractionPolicy(capabilities).actionSize, "touch");
  assert.equal(resolveInteractionMode(capabilities), "touch-like");
  // 1280x720 with a coarse pointer is a tablet, not a phone.
  assert.equal(resolveAppShellVariant(resolveLayoutMode(capabilities)), "desktop");
});

test("desktop capabilities keep hover and mixed wheel policies", () => {
  const capabilities = resolveDeviceCapabilities(createEnvironment({}));

  assert.equal(isTouchLikeDevice(capabilities), false);
  assert.equal(resolveTimelineInteractionPolicy(capabilities).supportsHover, true);
  assert.equal(resolveTimelineInteractionPolicy(capabilities).wheelMode, "mixed");
  assert.equal(resolveMidiEditorInteractionPolicy(capabilities).noteMoveDragThresholdPx, 4);
  assert.equal(resolveTrackListInteractionPolicy(capabilities).showsExplicitReorderButtons, false);
  assert.equal(resolveDialogInteractionPolicy(capabilities).actionSize, "compact");
  assert.equal(resolveInteractionMode(capabilities), "desktop-like");
  assert.equal(resolveAppShellVariant(resolveLayoutMode(capabilities)), "desktop");
});

test("portrait guidance only blocks phones held upright", () => {
  const phonePortrait = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, width: 390, height: 844 }),
  );
  const phoneLandscape = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, width: 844, height: 390 }),
  );
  const portraitPointer = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: false, hover: true, width: 820, height: 1180 }),
  );

  assert.equal(shouldShowPortraitGuidance(phonePortrait), true);
  assert.equal(shouldShowPortraitGuidance(phoneLandscape), false);
  assert.equal(shouldShowPortraitGuidance(portraitPointer), false);
});

test("a tablet gets the desktop shell while keeping touch interaction", () => {
  // iPad in landscape: coarse pointer, but 1180x820 has room for the track
  // list beside the timeline. Deciding the shell from pointer type alone put
  // a phone layout on a screen wider than most laptops.
  const tabletLandscape = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 5, width: 1180, height: 820 }),
  );
  const environment = resolveInteractionEnvironment(tabletLandscape);

  assert.equal(environment.layoutMode, "tablet");
  assert.equal(environment.shellVariant, "desktop");
  // The input affordances still have to be touch-sized.
  assert.equal(environment.interactionMode, "touch-like");
  assert.equal(environment.trackList.controlSize, "touch");
});

test("a tablet in portrait is not told to rotate", () => {
  const tabletPortrait = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 5, width: 820, height: 1180 }),
  );

  assert.equal(resolveLayoutMode(tabletPortrait), "tablet");
  assert.equal(shouldShowPortraitGuidance(tabletPortrait), false);
});

test("a phone is a phone in either orientation", () => {
  const portrait = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 5, width: 390, height: 844 }),
  );
  const landscape = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 5, width: 844, height: 390 }),
  );

  assert.equal(resolveLayoutMode(portrait), "phone");
  assert.equal(resolveLayoutMode(landscape), "phone");
  assert.equal(resolveInteractionEnvironment(landscape).shellVariant, "mobile");
});

test("a short pointer window keeps the desktop shell", () => {
  // Classifying by viewport size alone would hand a mouse user the phone
  // layout as soon as they made the window short.
  const shortWindow = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: false, hover: true, width: 820, height: 400 }),
  );

  assert.equal(resolveLayoutMode(shortWindow), "desktop");
  assert.equal(resolveInteractionEnvironment(shortWindow).shellVariant, "desktop");
});

test("interaction environment resolves shell variant and per-surface policies together", () => {
  const touchCapabilities = resolveDeviceCapabilities(
    createEnvironment({ coarsePointer: true, hover: false, maxTouchPoints: 4, width: 390, height: 844 }),
  );
  const desktopCapabilities = resolveDeviceCapabilities(createEnvironment({}));

  const touchEnvironment = resolveInteractionEnvironment(touchCapabilities);
  const desktopEnvironment = resolveInteractionEnvironment(desktopCapabilities);

  assert.equal(touchEnvironment.shellVariant, "mobile");
  assert.equal(touchEnvironment.timeline.wheelMode, "scroll");
  assert.equal(touchEnvironment.trackList.controlSize, "touch");
  assert.equal(touchEnvironment.showPortraitGuidance, true);

  assert.equal(desktopEnvironment.shellVariant, "desktop");
  assert.equal(desktopEnvironment.midiEditor.allowsModifierShortcuts, true);
  assert.equal(desktopEnvironment.dialog.actionSize, "compact");
  assert.equal(desktopEnvironment.showPortraitGuidance, false);
});
