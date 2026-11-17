// Adjusts the iOS project that `npx cap add ios` generates: HealthKit entitlement, the texts iOS shows
// when asking for access, signing team and version number. Run from the repository root in CI.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const TEAM_ID = process.env.APPLE_TEAM_ID ?? "";
const RUN_NUMBER = Number(process.env.GITHUB_RUN_NUMBER ?? "1");
if (TEAM_ID === "") throw new Error("APPLE_TEAM_ID is not set");

const INFO_PLIST = "ios/App/App/Info.plist";
const ENTITLEMENTS = "ios/App/App/App.entitlements";
const PROJECT = "ios/App/App.xcodeproj/project.pbxproj";

for (const path of [INFO_PLIST, PROJECT]) {
  if (!existsSync(path)) throw new Error(`expected file not found: ${path}`);
}

function update(path, change) {
  const before = readFileSync(path, "utf8");
  const after = change(before);
  if (after !== before) writeFileSync(path, after);
  console.log(`${after === before ? "unchanged" : "updated  "} ${path}`);
}

// Texts shown by iOS in its permission dialogs. Without them the app is rejected or crashes on the request.
const PLIST_STRINGS = {
  NSHealthShareUsageDescription: "האפליקציה קוראת אימונים (סוג, משך, מרחק וקלוריות) כדי לחשב את המאזן הקלורי היומי שלך.",
  NSHealthUpdateUsageDescription: "האפליקציה אינה כותבת נתונים לאפליקציית הבריאות.",
  NSCameraUsageDescription: "המצלמה משמשת לצילום ארוחה לצורך הערכת הערכים התזונתיים שלה.",
  NSPhotoLibraryUsageDescription: "הגלריה משמשת לבחירת תמונה של ארוחה לצורך הערכת הערכים התזונתיים שלה.",
};

update(INFO_PLIST, (text) => {
  const end = text.lastIndexOf("</dict>");
  if (end === -1) throw new Error("closing dict not found in Info.plist");
  let additions = "";
  for (const [key, value] of Object.entries(PLIST_STRINGS)) {
    if (!text.includes(`<key>${key}</key>`)) additions += `\t<key>${key}</key>\n\t<string>${value}</string>\n`;
  }
  // The app uses only standard HTTPS, which is exempt from export paperwork.
  if (!text.includes("<key>ITSAppUsesNonExemptEncryption</key>")) {
    additions += "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n";
  }
  return text.slice(0, end) + additions + text.slice(end);
});

writeFileSync(
  ENTITLEMENTS,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.developer.healthkit</key>
\t<true/>
\t<key>com.apple.developer.healthkit.access</key>
\t<array/>
</dict>
</plist>
`,
);
console.log(`written   ${ENTITLEMENTS}`);

update(PROJECT, (text) => {
  // Remove any signing settings the template carries, then set ours next to each bundle identifier
  // (the app target's Debug and Release configurations).
  let result = text.replace(/^[ \t]*(DEVELOPMENT_TEAM|CODE_SIGN_STYLE|CODE_SIGN_ENTITLEMENTS) = [^;]*;\n/gm, "");
  let targets = 0;
  result = result.replace(/^([ \t]*)PRODUCT_BUNDLE_IDENTIFIER = [^;]*;\n/gm, (line, indent) => {
    targets += 1;
    return (
      line +
      `${indent}CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n` +
      `${indent}CODE_SIGN_STYLE = Automatic;\n` +
      `${indent}DEVELOPMENT_TEAM = ${TEAM_ID};\n`
    );
  });
  if (targets === 0) throw new Error("no PRODUCT_BUNDLE_IDENTIFIER found in the Xcode project");
  console.log(`signing settings added to ${targets} build configurations`);
  return result
    .replace(/CURRENT_PROJECT_VERSION = [^;]*;/g, `CURRENT_PROJECT_VERSION = ${RUN_NUMBER};`)
    .replace(/MARKETING_VERSION = [^;]*;/g, `MARKETING_VERSION = 0.1.${RUN_NUMBER};`);
});

// App icon and launch image (see resources/icon.svg). Since Xcode 14 one 1024px icon is enough;
// it must have no transparency, which resources/icon-1024.png satisfies.
const ASSETS = "ios/App/App/Assets.xcassets";
const ICON_SET = `${ASSETS}/AppIcon.appiconset`;
mkdirSync(ICON_SET, { recursive: true });
for (const file of readdirSync(ICON_SET)) if (file.endsWith(".png")) rmSync(`${ICON_SET}/${file}`);
copyFileSync("resources/icon-1024.png", `${ICON_SET}/AppIcon-512@2x.png`);
writeFileSync(
  `${ICON_SET}/Contents.json`,
  JSON.stringify(
    {
      images: [{ filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" }],
      info: { author: "xcode", version: 1 },
    },
    null,
    2,
  ) + "\n",
);
console.log(`icon      ${ICON_SET}`);

// The launch screen shows the "Splash" image set; every file in it is replaced with the app's own.
const SPLASH_SET = `${ASSETS}/Splash.imageset`;
if (existsSync(SPLASH_SET)) {
  for (const file of readdirSync(SPLASH_SET)) {
    if (file.endsWith(".png")) copyFileSync("resources/splash-2732.png", `${SPLASH_SET}/${file}`);
  }
  console.log(`splash    ${SPLASH_SET}`);
} else {
  console.log(`missing   ${SPLASH_SET} (launch image left as generated)`);
}
