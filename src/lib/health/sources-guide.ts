// How to get workouts from each watch or app into Apple Health / Health Connect, where this app reads them.
// Checked against the official help pages (Strava, Samsung, Garmin) on 26.11.2026. Menu names change between
// versions, so the wording describes the path rather than promising exact labels.

export type GuidePlatform = "ios" | "android";

export type GuideSource = {
  id: string;
  label: string;
  steps: string[];
  /** Limits worth knowing before relying on it. */
  notes?: string[];
};

const OTHER: GuideSource = {
  id: "other",
  label: "שעון או אפליקציה אחרים",
  steps: [
    "פותחים את האפליקציה של השעון (Polar, Suunto, Coros, Amazfit, Huawei וכו').",
    "בהגדרות מחפשים \"אפליקציות מחוברות\", \"שיתוף נתונים\" או \"שירותים\".",
    "מחברים ל-{store} ומאשרים כתיבה של אימונים וקלוריות.",
  ],
  notes: ["אם אין לאפליקציה חיבור ל-{store}, האימונים לא יגיעו לבד. אפשר להוסיף אותם ידנית."],
};

export const GUIDE: Record<GuidePlatform, { store: string; sources: GuideSource[]; verify: string[]; fixes: string[] }> = {
  ios: {
    store: "Apple Health",
    sources: [
      {
        id: "apple_watch",
        label: "Apple Watch",
        steps: [
          "מתחילים אימון באפליקציית \"אימון\" בשעון. הוא נשמר באפליקציית בריאות לבד, בלי הגדרה.",
          "מוודאים שלאפליקציה שלנו יש גישה: אפליקציית בריאות ← תמונת הפרופיל ← אפליקציות ← מאזן קלורי ← לאפשר אימונים ואנרגיה פעילה.",
        ],
      },
      {
        id: "garmin",
        label: "Garmin",
        steps: [
          "באפליקציית Garmin Connect: עוד ← הגדרות ← אפליקציות מחוברות ← Apple Health.",
          "מחברים ומאשרים לפחות \"אימונים\" ו\"אנרגיה פעילה\".",
          "אחרי כל אימון מסנכרנים את השעון ל-Garmin Connect. משם הוא עובר לבריאות.",
        ],
        notes: ["אם החיבור כבר קיים: אפליקציית בריאות ← תמונת הפרופיל ← אפליקציות ← Connect, ולוודא ש\"אימונים\" מסומן."],
      },
      {
        id: "strava",
        label: "Strava",
        steps: [
          "ב-Strava: הלשונית \"אתה\" ← גלגל ההגדרות ← ניהול אפליקציות ומכשירים ← Health.",
          "מפעילים את \"Send to Health\" (שליחה ל-Health).",
          "במסך ההרשאות שנפתח מסמנים \"אימונים ומסלולים\" ומאשרים.",
        ],
        notes: [
          "עובד רק על אימונים חדשים, לא על אימונים שכבר הועלו.",
          "אם השעון הוא Garmin או מותג אחר, עדיף לחבר את האפליקציה של השעון ישירות לבריאות (ראו Garmin), ולא דרך Strava.",
        ],
      },
      OTHER,
    ],
    verify: [
      "אפליקציית בריאות ← עיון ← פעילות ← אימונים ← הצג את כל הנתונים.",
      "האימון צריך להופיע עם השעה והמקור (למשל Strava או Garmin).",
      "רואים רק צעדים בשעת האימון? זה אומר שהאימון עצמו לא הגיע. את הצעדים האייפון סופר לבד.",
    ],
    fixes: [
      "באפליקציה שלנו לוחצים \"סנכרון עכשיו\" בכרטיס הסנכרון במסך הבית.",
      "בודקים את ההרשאות: אפליקציית בריאות ← תמונת הפרופיל ← אפליקציות ← מאזן קלורי.",
      "הוספת את האימון ידנית לפני שהאמיתי הגיע? מחק את הידני, כדי שלא ייספר פעמיים.",
    ],
  },
  android: {
    store: "Health Connect",
    sources: [
      {
        id: "samsung",
        label: "שעון סמסונג",
        steps: [
          "באפליקציית Samsung Health בטלפון: שלוש הנקודות ← הגדרות ← Health Connect.",
          "מאשרים שיתוף של פעילות גופנית (אימונים) וקלוריות.",
          "בשעון: Samsung Health ← הגדרות ← זיהוי אימונים, ומפעילים הליכה, ריצה ורכיבה. כך גם אימון ששכחת להפעיל נרשם אחרי כ-10 דקות.",
        ],
        notes: [
          "אם שום דבר לא עובר: ב-Samsung Health ← הגדרות ← פרטיות, לוודא שההסכמה לעיבוד נתוני בריאות מופעלת.",
        ],
      },
      {
        id: "garmin",
        label: "Garmin",
        steps: [
          "באפליקציית Garmin Connect: עוד ← הגדרות ← אפליקציות מחוברות ← Health Connect.",
          "מחברים ומאשרים אימונים וקלוריות.",
          "אחרי כל אימון מסנכרנים את השעון ל-Garmin Connect. משם הוא עובר ל-Health Connect.",
        ],
        notes: ["דורש אנדרואיד 14 ומעלה."],
      },
      {
        id: "strava",
        label: "Strava",
        steps: [
          "ב-Strava: הלשונית \"אתה\" ← גלגל ההגדרות ← ניהול אפליקציות ומכשירים ← Health Connect.",
          "מחברים ומאשרים את ההרשאות.",
        ],
        notes: [
          "Strava שולחת ל-Health Connect רק אימונים עם GPS (ריצה, הליכה, רכיבה בחוץ). אימון כוח או אימון בבית לא יעבור, ואותו כדאי להוסיף ידנית.",
          "אם השעון הוא סמסונג או Garmin, עדיף לחבר את האפליקציה של השעון ישירות. כך עוברים גם אימונים בלי GPS.",
        ],
      },
      OTHER,
    ],
    verify: [
      "בהגדרות הטלפון מחפשים \"Health Connect\" ← נתונים וגישה ← פעילות ← אימונים.",
      "האימון צריך להופיע עם השעה והאפליקציה שכתבה אותו.",
      "רואים רק צעדים? זה אומר שהאימון עצמו לא הגיע.",
    ],
    fixes: [
      "באפליקציה שלנו לוחצים \"סנכרון עכשיו\" בכרטיס הסנכרון במסך הבית.",
      "בודקים ב-Health Connect ← הרשאות אפליקציות ← מאזן קלורי, שמותר לקרוא אימונים וקלוריות.",
      "הוספת את האימון ידנית לפני שהאמיתי הגיע? מחק את הידני, כדי שלא ייספר פעמיים.",
    ],
  },
};

/** Fills the store name into a guide line. */
export function guideText(line: string, store: string): string {
  return line.split("{store}").join(store);
}
