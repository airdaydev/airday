import { Dialog } from "@kobalte/core/dialog";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import { createSignal, Show } from "solid-js";
import type { Session } from "./Login.tsx";
import type { ThemePreference } from "./theme.ts";

type Section = "appearance" | "account";

export function Settings(props: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  themePref: ThemePreference;
  onThemeChange: (pref: ThemePreference) => void;
  session: Session;
  logout: () => void;
}) {
  const [section, setSection] = createSignal<Section>("appearance");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <div class="dialog-positioner">
          <Dialog.Content class="settings-dialog">
            <aside class="settings-sidebar">
              <Dialog.Title class="settings-title">Settings</Dialog.Title>
              <button
                type="button"
                class="settings-nav-item"
                data-active={section() === "appearance" ? "" : undefined}
                onClick={() => setSection("appearance")}
              >
                Appearance
              </button>
              <button
                type="button"
                class="settings-nav-item"
                data-active={section() === "account" ? "" : undefined}
                onClick={() => setSection("account")}
              >
                Account
              </button>
            </aside>
            <section class="settings-content">
              <Dialog.CloseButton class="settings-close" aria-label="Close">
                <CloseIcon />
              </Dialog.CloseButton>
              <Show when={section() === "appearance"}>
                <h2 class="settings-section-title">Appearance</h2>
                <div class="settings-row">
                  <div class="settings-row-label">Theme</div>
                  <SegmentedControl
                    class="theme-segmented"
                    aria-label="Theme"
                    value={props.themePref}
                    onChange={(value) =>
                      props.onThemeChange(value as ThemePreference)
                    }
                  >
                    <SegmentedControl.Item value="auto" class="theme-segment">
                      <SegmentedControl.ItemInput />
                      <SegmentedControl.ItemControl class="theme-segment-control">
                        <SegmentedControl.ItemLabel>
                          Auto
                        </SegmentedControl.ItemLabel>
                      </SegmentedControl.ItemControl>
                    </SegmentedControl.Item>
                    <SegmentedControl.Item value="light" class="theme-segment">
                      <SegmentedControl.ItemInput />
                      <SegmentedControl.ItemControl
                        class="theme-segment-control"
                        aria-label="Light"
                      >
                        <SunIcon />
                      </SegmentedControl.ItemControl>
                    </SegmentedControl.Item>
                    <SegmentedControl.Item value="dark" class="theme-segment">
                      <SegmentedControl.ItemInput />
                      <SegmentedControl.ItemControl
                        class="theme-segment-control"
                        aria-label="Dark"
                      >
                        <MoonIcon />
                      </SegmentedControl.ItemControl>
                    </SegmentedControl.Item>
                  </SegmentedControl>
                </div>
              </Show>
              <Show when={section() === "account"}>
                <h2 class="settings-section-title">Account</h2>
                <div class="settings-row">
                  <div class="settings-row-label">Email</div>
                  <div class="settings-row-value">{props.session.email}</div>
                </div>
                <div class="settings-row">
                  <button
                    type="button"
                    class="settings-logout"
                    onClick={() => props.logout()}
                  >
                    Log out
                  </button>
                </div>
              </Show>
            </section>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
