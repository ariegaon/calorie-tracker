# Calorie Tracker — הנחיות לפרויקט

אפליקציה אישית (Android-first, עברית, RTL) לניהול מאזן קלורי יומי, תזונה, שתייה,
פעילות ומשקל, כולל תחזית משקל לתאריך נבחר. המפרט המלא: `docs/SPEC.md`.
מצב ההתקדמות: `docs/PROGRESS.md` — לקרוא לפני כל עבודה ולעדכן בסוף כל שלב.

## החלטות שהתקבלו עם המשתמש

- **Stack:** Next.js (App Router) + TypeScript + Tailwind, Supabase (Auth, Postgres, Storage), Vercel.
- **אנדרואיד:** מעטפת Capacitor עם Health Connect (במקום Strava כמקור פעילויות ראשי).
  Samsung Health בטלפון (Galaxy S23 Ultra + Galaxy Watch) כותב ל-Health Connect, והאפליקציה קוראת משם
  ושומרת ב-Supabase. Strava אופציונלי, בשלב האחרון.
- **תחזית משקל:** בנוסף לסוף חודש ולמועד הגעה ליעד — תחזית לתאריך חופשי שהמשתמש בוחר.
- **עבודה מהטלפון בלבד:** למשתמש אין Android Studio. בנייה ובדיקות רצות ב-GitHub Actions,
  פריסה ב-Vercel, ה-APK יורד מ-GitHub.
- **עלויות:** כלים חינמיים בלבד ככל האפשר. ניתוח תמונות AI בתשלום לפי שימוש — לבחור ספק בשלב 6.
- **סודות:** לעולם לא בקוד ולא בצ'אט. מפתחות סודיים מוזנים ישירות ב-Vercel.

## תשתית

- GitHub: `ariegaon/calorie-tracker`
- Supabase: פרויקט `CalorieTracker`, ref `wdbepkiggtjxcotviuwv`, אזור eu-central-1.
  לא לגעת בפרויקטים אחרים בארגון (CoffeeCareDB, BoardNewsDerehHashalom23).
- Migrations נשמרים ב-`supabase/migrations/` ומוחלים על הפרויקט.

## כללי עבודה

- לעבוד שלב אחד בכל פעם לפי `docs/PROGRESS.md`, ולהמתין לאישור המשתמש לפני מעבר לשלב הבא.
- כל חישוב משמעותי (BMR, TDEE, מאזן, תחזית) נמצא ב-`src/lib/calculations/` כפונקציות טהורות עם בדיקות יחידה.
- כל טבלה אישית כוללת `user_id` ו-RLS. אין Service Role Key בצד לקוח.
- נתון שמקורו בהערכה (AI, נוסחה) מסומן כהערכה ולא כמדידה.
- ממשק בעברית, RTL, Mobile-first. תשובות למשתמש בעברית, קצרות — הוא עובד מהטלפון.
