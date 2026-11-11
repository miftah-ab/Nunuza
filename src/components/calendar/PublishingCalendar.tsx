"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
} from "lucide-react";

interface ScheduledCalendarPost {
  id: string;
  text: string;
  internal_title: string | null;
  pillar: string | null;
  scheduled_at: string;
}

interface PublishingCalendarProps {
  posts: ScheduledCalendarPost[];
  initialMonth: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

function postTitle(post: ScheduledCalendarPost): string {
  const title = post.internal_title?.trim();
  if (title) return title;
  const firstLine = post.text.trim().split("\n")[0] || "LinkedIn post";
  return firstLine.length > 64 ? `${firstLine.slice(0, 61)}…` : firstLine;
}

export function PublishingCalendar({
  posts,
  initialMonth,
}: PublishingCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(initialMonth)
  );
  const [selectedDate, setSelectedDate] = useState(
    () => new Date(initialMonth).getDate()
  );

  // Keep server and first client render deterministic, then use the viewer's
  // local calendar month (the scheduling form stores an absolute ISO instant).
  useEffect(() => {
    const today = new Date();
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today.getDate());
  }, []);

  const postsByDate = useMemo(() => {
    const grouped = new Map<string, ScheduledCalendarPost[]>();
    for (const post of posts) {
      const scheduledDate = new Date(post.scheduled_at);
      if (Number.isNaN(scheduledDate.getTime())) continue;
      const key = dateKey(scheduledDate);
      const existing = grouped.get(key) ?? [];
      existing.push(post);
      grouped.set(key, existing);
    }
    for (const dayPosts of grouped.values()) {
      dayPosts.sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() -
          new Date(b.scheduled_at).getTime()
      );
    }
    return grouped;
  }, [posts]);

  const monthStart = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    1
  );
  const monthEnd = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    0
  );
  const leadingDays = (monthStart.getDay() + 6) % 7;
  const daysInMonth = monthEnd.getDate();
  const calendarCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;
  const todayKey = dateKey(new Date());
  const selectedDateObject = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth(),
    selectedDate
  );
  const selectedKey = dateKey(selectedDateObject);
  const selectedPosts = postsByDate.get(selectedKey) ?? [];

  const goToMonth = (offset: number) => {
    const nextMonth = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + offset,
      1
    );
    setVisibleMonth(nextMonth);
    setSelectedDate(1);
  };

  const goToToday = () => {
    const today = new Date();
    setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today.getDate());
  };

  const scheduledCount = posts.length;

  return (
    <section className="space-y-4" aria-label="Scheduled LinkedIn publications">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-ink-secondary">
            {scheduledCount} {scheduledCount === 1 ? "post" : "posts"} scheduled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={goToToday} className="btn-secondary text-xs">
            Today
          </button>
          <div className="flex items-center rounded-lg border border-border bg-white">
            <button
              type="button"
              onClick={() => goToMonth(-1)}
              className="p-2 text-ink-secondary transition-colors hover:bg-surface hover:text-ink rounded-l-lg"
              aria-label="Previous month"
            >
              <ChevronLeft size={17} />
            </button>
            <span className="min-w-32 px-2 text-center text-sm font-semibold text-ink">
              {monthLabel(visibleMonth)}
            </span>
            <button
              type="button"
              onClick={() => goToMonth(1)}
              className="p-2 text-ink-secondary transition-colors hover:bg-surface hover:text-ink rounded-r-lg"
              aria-label="Next month"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface/70">
            {WEEKDAYS.map((weekday) => (
              <div
                key={weekday}
                className="py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-secondary"
              >
                {weekday}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: calendarCells }, (_, index) => {
              const dayNumber = index - leadingDays + 1;
              const isCurrentMonth =
                dayNumber >= 1 && dayNumber <= daysInMonth;
              const cellDate = isCurrentMonth
                ? new Date(
                    visibleMonth.getFullYear(),
                    visibleMonth.getMonth(),
                    dayNumber
                  )
                : null;
              const key = cellDate ? dateKey(cellDate) : "";
              const dayPosts = key ? postsByDate.get(key) ?? [] : [];
              const isSelected = isCurrentMonth && dayNumber === selectedDate;
              const isToday = key === todayKey;

              return (
                <div
                  key={index}
                  className="min-h-[76px] border-b border-r border-border p-1 sm:min-h-[112px] sm:p-2"
                >
                  {isCurrentMonth ? (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(dayNumber)}
                      aria-pressed={isSelected}
                      aria-label={`${cellDate.toLocaleDateString()}, ${dayPosts.length} scheduled posts`}
                      className={`flex h-full min-h-[66px] w-full flex-col items-start rounded-lg p-1.5 text-left transition-colors sm:min-h-[96px] sm:p-2 ${
                        isSelected
                          ? "bg-forest-light ring-1 ring-forest/30"
                          : "hover:bg-surface"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                          isToday
                            ? "bg-forest text-white"
                            : isSelected
                              ? "text-forest"
                              : "text-ink"
                        }`}
                      >
                        {dayNumber}
                      </span>
                      {dayPosts.length > 0 && (
                        <span className="mt-1 flex w-full flex-col gap-1">
                          {dayPosts.slice(0, 2).map((post) => (
                            <span
                              key={post.id}
                              className="hidden truncate rounded bg-forest-light px-1.5 py-0.5 text-[10px] font-medium text-forest sm:block"
                              title={postTitle(post)}
                            >
                              {postTitle(post)}
                            </span>
                          ))}
                          <span className="flex items-center gap-1 px-1 text-[10px] font-medium text-forest sm:hidden">
                            <span className="h-1.5 w-1.5 rounded-full bg-forest" />
                            {dayPosts.length}
                          </span>
                          {dayPosts.length > 2 && (
                            <span className="hidden px-1 text-[10px] text-ink-secondary sm:block">
                              +{dayPosts.length - 2} more
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  ) : (
                    <span className="block p-2 text-xs text-ink-muted/40">
                      {dayNumber <= 0
                        ? new Date(
                            visibleMonth.getFullYear(),
                            visibleMonth.getMonth(),
                            dayNumber
                          ).getDate()
                        : new Date(
                            visibleMonth.getFullYear(),
                            visibleMonth.getMonth() + 1,
                            dayNumber - daysInMonth
                          ).getDate()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="card flex flex-col p-4 sm:p-5" aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                Selected day
              </p>
              <h2 className="mt-1 text-lg font-semibold text-ink">
                {selectedDateObject.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h2>
            </div>
            <CalendarDays size={19} className="mt-1 text-forest" />
          </div>

          {selectedPosts.length > 0 ? (
            <div className="divide-y divide-border">
              {selectedPosts.map((post) => (
                <article key={post.id} className="py-3 first:pt-0 last:pb-0">
                  <h3 className="text-sm font-semibold leading-snug text-ink">
                    {postTitle(post)}
                  </h3>
                  {post.pillar && (
                    <p className="mt-1 text-xs text-ink-secondary">
                      {post.pillar}
                    </p>
                  )}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-secondary">
                    <Clock3 size={13} />
                    {new Date(post.scheduled_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface">
                <CalendarDays size={18} className="text-ink-secondary" />
              </div>
              <p className="text-sm font-medium text-ink">Nothing scheduled</p>
              <p className="mt-1 max-w-[220px] text-xs leading-relaxed text-ink-secondary">
                There are no LinkedIn posts scheduled for this date.
              </p>
            </div>
          )}

          <Link
            href="/app/content"
            className="btn-primary mt-4 w-full justify-center text-xs"
          >
            <Plus size={14} />
            Manage content
          </Link>
        </aside>
      </div>
    </section>
  );
}
