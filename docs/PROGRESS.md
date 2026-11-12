# מצב הפיתוח

עודכן לאחרונה: 2026-11-12

## שלבים

| # | שלב | מצב |
|---|------|------|
| 1 | בסיס: שלד Next.js, RTL, התחברות, מסד נתונים עם RLS, פרופיל | נבנה ונפרס, ממתין לבדיקת המשתמש בטלפון |
| 2 | מנוע חישובים: BMR, TDEE, מאזן + בדיקות יחידה | ממתין לאישור המשתמש |
| 3 | מסך בית והזנה ידנית: מזון, שתייה, פעילות, משקל, ציר זמן | לא התחיל |
| 4 | משקל ותחזית: גרף, ממוצע נע, תחזית לתאריך, איכות נתונים, כיול | לא התחיל |
| 5 | אנדרואיד: מעטפת Capacitor + Health Connect, בניית APK ב-GitHub Actions | לא התחיל |
| 6 | צילום ארוחה ב-AI: ניתוח, אישור ועריכה, מועדפים | לא התחיל |
| 7 | דוחות והתראות: יומי, שבועי, חודשי, ייצוא CSV | לא התחיל |
| 8 | ליטוש ו-QA: בדיקות במכשיר, אבטחה, תיעוד, Strava אופציונלי | לא התחיל |

## יומן

### 2026-11-12
- נוצר פרויקט Supabase `CalorieTracker` (ref `wdbepkiggtjxcotviuwv`).
- נוצר המאגר `ariegaon/calorie-tracker`.
- נוספו `CLAUDE.md`, `docs/SPEC.md`, `docs/PROGRESS.md`.
- שלב 1, מסד נתונים: הוחל `0001_core_schema` — 7 טבלאות (profiles, food_entries, food_entry_items,
  drink_entries, activities, weight_logs, body_measurements), RLS עם 4 מדיניות לכל טבלה, בדיקת האבטחה של Supabase נקייה.
  טבלאות נגזרות (סיכומים, תחזיות, כיול, אינטגרציות) יתווספו בשלבים 4–5.
- שלב 1, קוד: שלד Next.js 16 + Tailwind 4, RTL, התחברות באימייל וסיסמה (Supabase בצד לקוח, RLS),
  מסך פרופיל/Onboarding עם ולידציה, מסך בית זמני. 8 בדיקות יחידה לוולידציה עוברות (`npm test`).
- Vercel: נוצר פרויקט `calorie-tracker` (`prj_aB09Tb8c2Ijlw6aJKdUuV9iz0kt3`), Node 24, הגנת SSO רק על כתובות preview.
  הבנייה הראשונה עברה. כתובת: https://calorie-tracker-gaondev.vercel.app
- נותר בשלב 1: בדיקה של המשתמש בטלפון (הרשמה, פרופיל), והגדרת Site URL ב-Supabase Auth לכתובת ה-Vercel (פעולה ידנית של המשתמש).
- שלב 2: `src/lib/calculations/energy.ts` — BMR (Mifflin-St Jeor), הוצאה בסיסית, קלוריות פעילות לאימון
  (Active כפי שדווח; Total פחות חלק המנוחה; Total בלי משך לא נספר), סיכום יומי בלי ספירה כפולה, מאזן יומי
  (סף איזון 50 קק"ל), שינוי משקל תיאורטי (7,700), יעד צריכה לפי קצב עם רצפה (1,500 גבר / 1,200 אישה).
  19 בדיקות יחידה, סך הכול 27 עוברות. מסך הבית מציג כרטיס הערכת הוצאה יומית.

## בעיות פתוחות

- הפרויקט ב-Vercel אינו מקושר ל-Git (לאינטגרציית GitHub של Vercel אין גישה למאגר), ולכן אין פריסה אוטומטית בדחיפה.
  אחרי כל דחיפה יש להפעיל פריסה עם `create_deployment` ו-`gitSource` (github, ariegaon/calorie-tracker, main, target production). עובד כל עוד המאגר ציבורי.
- הזרימות עצמן (הרשמה, שמירת פרופיל) עוד לא נבדקו בדפדפן אמיתי.
- Vercel: משתני הסביבה הנדרשים הם `NEXT_PUBLIC_SUPABASE_URL` ו-`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. צוות: `gaondev` (`team_TEodwHOSdbadSdhdRcpQl4iu`).
