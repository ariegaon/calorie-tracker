import type { Metadata } from "next";

export const metadata: Metadata = { title: "מדיניות פרטיות · מאזן קלורי" };

/** Shown by Health Connect when the user asks why the app wants access to health data. */
export default function PrivacyPage() {
  return (
    <main className="space-y-4 pb-10 leading-relaxed">
      <h1 className="text-2xl font-bold">מדיניות פרטיות</h1>
      <p>מאזן קלורי היא אפליקציה אישית למעקב אחר תזונה, שתייה, פעילות ומשקל.</p>

      <h2 className="text-lg font-semibold">מידע מ-Health Connect ומ-Apple Health</h2>
      <p>
        באישורך, האפליקציה קוראת אימונים מ-Health Connect (באנדרואיד) או מ-Apple Health (באייפון): סוג האימון, זמן התחלה
        וסיום, משך, מרחק וקלוריות. היא קוראת בלבד, ואינה כותבת או משנה שם מידע.
      </p>
      <p>
        המידע משמש לחישוב המאזן הקלורי היומי ולהצגת האימונים ביומן שלך. הוא נשמר בחשבון שלך בלבד, ואינו נמכר, אינו
        משותף עם צד שלישי ואינו משמש לפרסום.
      </p>

      <h2 className="text-lg font-semibold">מה נשמר ואיפה</h2>
      <p>
        הנתונים שאתה מזין והאימונים שסונכרנו נשמרים במסד נתונים של Supabase, תחת החשבון שלך. רק משתמש מחובר יכול לקרוא
        את הנתונים של עצמו.
      </p>

      <h2 className="text-lg font-semibold">ניתוח ארוחות</h2>
      <p>
        כשאתה מבקש לנתח ארוחה, התמונה והתיאור נשלחים ל-OpenAI לצורך הניתוח בלבד, בלי פרטים מזהים. התמונה אינה נשמרת
        באפליקציה.
      </p>

      <h2 className="text-lg font-semibold">ביטול ומחיקה</h2>
      <p>
        אפשר לבטל את ההרשאה בכל עת בהגדרות של Health Connect או באפליקציית הבריאות של Apple. כל רשומה ביומן ניתנת למחיקה מתוך האפליקציה, ומחיקת החשבון
        מוחקת את כל הנתונים שלו.
      </p>
    </main>
  );
}
