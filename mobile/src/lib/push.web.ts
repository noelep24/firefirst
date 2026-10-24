// Browsers don't get push notifications from FireFirst; this keeps expo-notifications out of the web build.
export async function registerForPush() {}

export function listenForNotificationTaps() {
  return () => {};
}
