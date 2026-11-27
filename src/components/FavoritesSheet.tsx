"use client";

// All favorites, grouped by when they are eaten, with search, editing, and "eaten recently".

import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { favoriteCalories, type Favorite } from "@/lib/favorites";
import {
  SLOT_LABELS,
  SLOTS,
  favoriteSlots,
  matchesQuery,
  rankFavorites,
  slotOfHour,
  type FavoriteUse,
  type RecentEntry,
  type TimeSlot,
} from "@/lib/favorites-ranking";

function Chip({
  label,
  kcal,
  busy,
  disabled,
  onClick,
  removable,
  onRemove,
  onStar,
}: {
  label: string;
  kcal: number;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
  removable?: boolean;
  onRemove?: () => void;
  onStar?: () => void;
}) {
  const joined = removable || onStar;
  return (
    <li className="flex items-center">
      <button
        type="button"
        disabled={disabled || removable}
        onClick={onClick}
        className={
          "min-h-11 border border-slate-300 bg-white px-3 text-start text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-70 " +
          (joined ? "rounded-s-full" : "rounded-full")
        }
      >
        {busy ? "רגע… " : ""}
        {label}
        <span className="text-slate-500"> · {Math.round(kcal)} קק"ל</span>
      </button>
      {removable ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`הסרת ${label} מהמועדפים`}
          className="flex min-h-11 w-11 items-center justify-center rounded-e-full border border-s-0 border-red-300 bg-red-50 text-lg text-red-700 hover:bg-red-100"
        >
          ×
        </button>
      ) : onStar ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onStar}
          aria-label={`שמירת ${label} כמועדף`}
          className="flex min-h-11 w-11 items-center justify-center rounded-e-full border border-s-0 border-slate-300 bg-white text-lg text-amber-500 hover:bg-amber-50"
        >
          ☆
        </button>
      ) : null}
    </li>
  );
}

export function FavoritesSheet({
  favorites,
  uses,
  recent,
  now,
  busyId,
  onClose,
  onAddFavorite,
  onRemoveFavorite,
  onAddRecent,
  onStarRecent,
}: {
  favorites: Favorite[];
  uses: FavoriteUse[];
  recent: RecentEntry[];
  now: Date;
  busyId: string | null;
  onClose: () => void;
  onAddFavorite: (favorite: Favorite) => void;
  onRemoveFavorite: (favorite: Favorite) => void;
  onAddRecent: (entry: RecentEntry) => void;
  onStarRecent: (entry: RecentEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const busy = busyId !== null;
  const ranked = rankFavorites(favorites, uses, now);

  const favoriteChip = (favorite: Favorite, keyPrefix: string) => (
    <Chip
      key={`${keyPrefix}:${favorite.id}`}
      label={favorite.name}
      kcal={favoriteCalories(favorite)}
      busy={busyId === favorite.id}
      disabled={busy}
      onClick={() => onAddFavorite(favorite)}
      removable={editing}
      onRemove={() => onRemoveFavorite(favorite)}
    />
  );
  const recentChip = (entry: RecentEntry) => (
    <Chip
      key={entry.key}
      label={entry.name}
      kcal={entry.kcal}
      busy={busyId === entry.key}
      disabled={busy || editing}
      onClick={() => onAddRecent(entry)}
      onStar={editing ? undefined : () => onStarRecent(entry)}
    />
  );

  // Groups start from the current part of the day.
  const current = slotOfHour(now.getHours());
  const order: TimeSlot[] = [...SLOTS.slice(SLOTS.indexOf(current)), ...SLOTS.slice(0, SLOTS.indexOf(current))];
  const slotsById = new Map(ranked.map((f) => [f.id, favoriteSlots(uses, f.id, now)]));
  const unused = ranked.filter((f) => (slotsById.get(f.id) ?? []).length === 0);

  const searching = query.trim() !== "";
  const foundFavorites = ranked.filter((f) => matchesQuery(f.name, query));
  const foundRecent = recent.filter((r) => matchesQuery(r.name, query));

  return (
    <Sheet title="מועדפים" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 חיפוש"
            aria-label="חיפוש במועדפים"
            className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base"
          />
          {favorites.length > 0 ? (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="min-h-11 rounded-xl px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              {editing ? "סיום" : "עריכה"}
            </button>
          ) : null}
        </div>
        <p className="text-xs text-slate-500">
          {editing
            ? "לחיצה על × מסירה מהמועדפים. הארוחות שכבר נרשמו לא נמחקות."
            : "לחיצה מוסיפה ליום שמוצג. המועדפים מקובצים לפי השעות שבהן אתה מוסיף אותם בדרך כלל, והקבוצה של השעה הזו ראשונה."}
        </p>

        {searching ? (
          <section className="space-y-2">
            {foundFavorites.length === 0 && foundRecent.length === 0 ? (
              <p className="text-sm text-slate-600">לא נמצא שום דבר בשם הזה.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {foundFavorites.map((f) => favoriteChip(f, "found"))}
                {foundRecent.map(recentChip)}
              </ul>
            )}
          </section>
        ) : (
          <>
            {recent.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">אכלת לאחרונה</h3>
                <ul className="flex flex-wrap gap-2">{recent.map(recentChip)}</ul>
                <p className="text-xs text-slate-500">☆ שומר כמועדף.</p>
              </section>
            ) : null}
            {order.map((slot) => {
              const inSlot = ranked.filter((f) => (slotsById.get(f.id) ?? []).includes(slot));
              if (inSlot.length === 0) return null;
              return (
                <section key={slot} className="space-y-2">
                  <h3 className="text-sm font-semibold text-slate-700">
                    {SLOT_LABELS[slot]}
                    {slot === current ? (
                      <span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        עכשיו
                      </span>
                    ) : null}
                  </h3>
                  <ul className="flex flex-wrap gap-2">{inSlot.map((f) => favoriteChip(f, slot))}</ul>
                </section>
              );
            })}
            {unused.length > 0 ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-700">לא נוספו לאחרונה</h3>
                <ul className="flex flex-wrap gap-2">{unused.map((f) => favoriteChip(f, "unused"))}</ul>
              </section>
            ) : null}
            {favorites.length === 0 && recent.length === 0 ? (
              <p className="text-sm text-slate-600">עוד אין מועדפים.</p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
