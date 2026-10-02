import { useCallback, useEffect, useMemo, useRef } from "react";

import type { AlertPrefs } from "../../../shared/notify-policy.ts";
import { sendTestPush } from "../../lib/api.ts";
import { useT } from "../../lib/i18n.ts";
import { notificationState, requestNotificationPermission } from "../../lib/notifications.ts";
import { ensurePushSubscription, pushSupported, removePushSubscription } from "../../lib/push.ts";
import { alertPrefs, useSettings } from "../../lib/settings.ts";
import { setApp, useAppStore } from "../../store/appStore.ts";
import type { AlertSettings } from "./paneAlerts.ts";

export interface Bell {
  label: string;
  title: string;
  on: boolean;
  run: () => Promise<unknown>;
}

export function useAlertSettingsReader(): { alerts: AlertPrefs; alertsOn: boolean; read: () => AlertSettings } {
  const { settings } = useSettings();
  const alerts = useMemo(() => alertPrefs(settings), [settings.alertInput, settings.alertDone]);
  const latest = useRef<AlertSettings>({ alerts, on: settings.alertsOn, inApp: settings.alertInApp });
  latest.current = { alerts, on: settings.alertsOn, inApp: settings.alertInApp };
  const read = useCallback(() => latest.current, []);
  return { alerts, alertsOn: settings.alertsOn, read };
}

async function subscribeWithConfirmation(alerts: AlertPrefs): Promise<boolean> {
  try {
    const endpoint = await ensurePushSubscription(alerts);
    setApp({ pushOn: endpoint !== null });
    if (endpoint) await sendTestPush(endpoint);
    return endpoint !== null;
  } catch (err) {
    console.warn("web push unavailable, alerts stay tab-only", err);
    return false;
  }
}

function usePushRegistration(alerts: AlertPrefs, alertsOn: boolean): void {
  const locked = useAppStore((state) => state.locked);
  const notifications = useAppStore((state) => state.notifications);
  useEffect(() => {
    if (locked !== false || notifications !== "granted" || !alertsOn || !pushSupported()) return;
    let cancelled = false;
    ensurePushSubscription(alerts)
      .then((endpoint) => { if (!cancelled) setApp({ pushOn: endpoint !== null }); })
      .catch(() => { if (!cancelled) setApp({ pushOn: false }); });
    return () => { cancelled = true; };
  }, [locked, notifications, alerts, alertsOn]);
}

export function useNotifications(alerts: AlertPrefs, alertsOn: boolean) {
  const t = useT();
  const { update: updateSettings } = useSettings();
  const notifications = useAppStore((state) => state.notifications);
  const pushOn = useAppStore((state) => state.pushOn);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  usePushRegistration(alerts, alertsOn);

  const enableNotifications = useCallback(async () => {
    const next = notificationState() === "granted" ? "granted" : await requestNotificationPermission();
    setApp({ notifications: next });
    if (next !== "granted") return false;
    updateSettings({ alertsOn: true });
    return subscribeWithConfirmation(alertsRef.current);
  }, [updateSettings]);

  const disableNotifications = useCallback(async () => {
    updateSettings({ alertsOn: false });
    setApp({ pushOn: false });
    await removePushSubscription().catch((err) => console.warn("could not drop the push subscription", err));
  }, [updateSettings]);

  const bell = useMemo<Bell>(() => {
    if (notifications !== "granted") return { label: t("Enable notifications"), title: t("Notify me when a pane needs input or finishes"), on: false, run: enableNotifications };
    if (!alertsOn) return { label: t("Alerts off"), title: t("Alerts off on this device — tap to turn them on"), on: false, run: enableNotifications };
    if (pushOn) return { label: t("Alerts on"), title: t("Alerts on — pushed to this device, even with the app closed. Tap to turn them off"), on: true, run: disableNotifications };
    return {
      label: t("Alerts on in this tab"),
      title: pushSupported()
        ? t("Alerts on while this tab is open. Tap to turn them off")
        : t("Alerts on while this tab is open (closed-app alerts need https, and on iPhone the home-screen app). Tap to turn them off"),
      on: true,
      run: disableNotifications,
    };
  }, [t, notifications, alertsOn, pushOn, enableNotifications, disableNotifications]);

  const bellVisible = notifications !== "unsupported" && notifications !== "denied";
  return { bell, bellVisible, enableNotifications };
}
