import { Dialog } from "@kobalte/core/dialog";
import { SegmentedControl } from "@kobalte/core/segmented-control";
import { createEffect, createSignal, For, Show, untrack } from "solid-js";
import { api, type Device } from "./api.ts";
import type { Session } from "./Login.tsx";
import type { ThemePreference } from "./theme.ts";

type Section = "appearance" | "account" | "devices";

export function Settings(props: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  themePref: ThemePreference;
  onThemeChange: (pref: ThemePreference) => void;
  session: Session;
  logout: () => void;
}) {
  const [section, setSection] = createSignal<Section>("appearance");
  const [devices, setDevices] = createSignal<Device[] | null>(null);
  const [devicesError, setDevicesError] = createSignal<string | null>(null);
  const [devicesLoading, setDevicesLoading] = createSignal(false);
  const [revoking, setRevoking] = createSignal<ReadonlySet<string>>(new Set());

  async function revokeDevice(id: string) {
    setDevicesError(null);
    setRevoking((prev) => new Set(prev).add(id));
    try {
      await api.deleteDevice(id);
      setDevices((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
    } catch (e) {
      setDevicesError(e instanceof Error ? e.message : "Failed to revoke device");
    } finally {
      setRevoking((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function loadDevices() {
    setDevicesError(null);
    setDevicesLoading(true);
    try {
      const res = await api.listDevices();
      setDevices(res.devices);
    } catch (e) {
      setDevicesError(e instanceof Error ? e.message : "Failed to load devices");
    } finally {
      setDevicesLoading(false);
    }
  }

  // Refetch every time the Devices section is entered while authenticated.
  // `devicesLoading` is read untracked — it's a guard against stomping an
  // in-flight fetch, not a trigger; tracking it would self-loop when
  // loadDevices flips it back to false.
  createEffect(() => {
    if (props.open && section() === "devices" && !props.session.anonymous) {
      if (!untrack(devicesLoading)) {
        void loadDevices();
      }
    }
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay class="dialog-overlay" />
        <div class="dialog-positioner">
          <Dialog.Content class="settings-dialog">
            <aside class="settings-sidebar">
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
              <button
                type="button"
                class="settings-nav-item"
                data-active={section() === "devices" ? "" : undefined}
                onClick={() => setSection("devices")}
              >
                Devices
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
                    <SegmentedControl.Indicator class="theme-segment-indicator" />
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
                <Show
                  when={props.session.anonymous}
                  fallback={
                    <>
                      <div class="settings-row">
                        <div class="settings-row-label">Email</div>
                        <div class="settings-row-value">
                          {props.session.email}
                        </div>
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
                    </>
                  }
                >
                  <div class="settings-row">
                    <div class="settings-row-value">
                      You're using a local-only account. Use Sign in or
                      Sign up from the account menu to back up your data
                      and sync across devices.
                    </div>
                  </div>
                </Show>
              </Show>
              <Show when={section() === "devices"}>
                <h2 class="settings-section-title">Devices</h2>
                <Show
                  when={!props.session.anonymous}
                  fallback={
                    <div class="settings-row">
                      <div class="settings-row-value">
                        Log in to see devices linked to your account.
                      </div>
                    </div>
                  }
                >
                  <Show when={devicesLoading() && devices() === null}>
                    <div class="settings-row">
                      <div class="settings-row-value">Loading…</div>
                    </div>
                  </Show>
                  <Show when={devicesError()}>
                    <div class="settings-row">
                      <div class="settings-row-value">{devicesError()}</div>
                    </div>
                  </Show>
                  <Show when={devices()}>
                    <ul class="device-list">
                      <For each={devices()!}>
                        {(d) => (
                          <li class="device-row">
                            <div class="device-row-main">
                              <div class="device-name">
                                {d.name}
                                <Show when={d.id === props.session.deviceId}>
                                  <span class="device-current-tag">
                                    This device
                                  </span>
                                </Show>
                              </div>
                              <div class="device-meta">
                                Last seen {formatRelative(d.last_seen_at)}
                              </div>
                            </div>
                            <Show when={d.id !== props.session.deviceId}>
                              <button
                                type="button"
                                class="device-revoke"
                                disabled={revoking().has(d.id)}
                                onClick={() => void revokeDevice(d.id)}
                              >
                                {revoking().has(d.id) ? "Revoking…" : "Revoke"}
                              </button>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
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

function formatRelative(ms: number): string {
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diffSec < 86400 * 7) {
    const d = Math.floor(diffSec / 86400);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  return new Date(ms).toLocaleDateString();
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
