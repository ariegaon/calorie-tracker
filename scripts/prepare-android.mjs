// Adjusts the Android project that `npx cap add android` generates: minimum SDK, Health Connect
// permissions, the privacy policy link and the version number. Run from the repository root in CI.

import { readFileSync, writeFileSync } from "node:fs";

const PRIVACY_URL = "https://calorie-tracker-gaondev.vercel.app/privacy";

const HEALTH_PERMISSIONS = [
  "android.permission.health.READ_EXERCISE",
  "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
  "android.permission.health.READ_TOTAL_CALORIES_BURNED",
  "android.permission.health.READ_DISTANCE",
];

function update(path, change) {
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? "unchanged" : "updated  "} ${path}`);
}

// Health Connect needs Android 8 (API 26) or later.
update("android/variables.gradle", (text) => {
  if (!/minSdkVersion\s*=\s*\d+/.test(text)) throw new Error("minSdkVersion not found in variables.gradle");
  return text.replace(/minSdkVersion\s*=\s*(\d+)/, (match, value) => (Number(value) >= 26 ? match : "minSdkVersion = 26"));
});

update("android/app/src/main/AndroidManifest.xml", (text) => {
  const missing = HEALTH_PERMISSIONS.filter((name) => !text.includes(`"${name}"`));
  if (missing.length === 0) return text;
  if (!text.includes("</manifest>")) throw new Error("closing manifest tag not found");
  const lines = missing.map((name) => `    <uses-permission android:name="${name}" />`).join("\n");
  return text.replace("</manifest>", `${lines}\n</manifest>`);
});

update("android/app/src/main/res/values/strings.xml", (text) => {
  if (text.includes("health_connect_privacy_policy_url")) return text;
  if (!text.includes("</resources>")) throw new Error("closing resources tag not found");
  return text.replace(
    "</resources>",
    `    <string name="health_connect_privacy_policy_url">${PRIVACY_URL}</string>\n</resources>`,
  );
});

// A rising version code lets a new build install over the previous one.
const runNumber = Number(process.env.GITHUB_RUN_NUMBER ?? "1");
update("android/app/build.gradle", (text) =>
  text
    .replace(/versionCode\s+\d+/, `versionCode ${runNumber}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "0.1.${runNumber}"`),
);
