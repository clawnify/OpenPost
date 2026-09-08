import { useEffect, useState, useMemo } from "preact/hooks";
import { ChevronLeft, ChevronRight } from "lucide-preact";
import { useApp } from "../context";
import { PLATFORM_LABELS } from "../types";
import { QuickEditDialog } from "./quick-edit-dialog";
import type { Post } from "../types";

interface Props {
  navigate: (path: string) => void;
}

export function CalendarView({ navigate }: Props) {
  const [editing, setEditing] = useState<Post | null>(null);
  const { calendarData, calendarMonth, setCalendarMonth, loadCalendar } = useApp();

  useEffect(() => {
    loadCalendar(calendarMonth);
  }, [calendarMonth]);

  const [year, month] = calendarMonth.split("-").map(Number);

  const prevMonth = () => {
    const d = new Date(year, month - 2, 1);
    setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const nextMonth = () => {
    const d = new Date(year, month, 1);
    setCalendarMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const monthLabel = new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const grid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells: Array<{ day: number | null; key: string }> = [];

    for (let i = 0; i < firstDay; i++) {
      cells.push({ day: null, key: `empty-${i}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, key: `day-${d}` });
    }
    return cells;
  }, [year, month]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Calendar</h1>
        <button
          class="btn-primary"
          onClick={() => navigate("/compose")}
        >
          New Post
        </button>
      </div>

      {/* Month nav */}
      <div class="flex items-center justify-center gap-4 mb-6">
        <button class="p-1.5 rounded-md hover:bg-accent transition-colors" onClick={prevMonth}>
          <ChevronLeft size={18} />
        </button>
        <h2 class="text-base font-semibold w-48 text-center">{monthLabel}</h2>
        <button class="p-1.5 rounded-md hover:bg-accent transition-colors" onClick={nextMonth}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Grid */}
      <div class="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} class="bg-muted px-2 py-2 text-xs font-medium text-muted-foreground text-center">
            {d}
          </div>
        ))}
        {grid.map((cell) => {
          if (cell.day === null) {
            return <div key={cell.key} class="bg-card min-h-[100px]" />;
          }
          const dateStr = `${calendarMonth}-${String(cell.day).padStart(2, "0")}`;
          const dayPosts = calendarData[dateStr] || [];
          const isToday = dateStr === todayStr;

          return (
            <div
              key={cell.key}
              class={`bg-card min-h-[100px] p-1.5 cursor-pointer hover:bg-accent/50 transition-colors ${
                isToday ? "ring-1 ring-inset ring-accent" : ""
              }`}
              onClick={() => {
                if (dayPosts.length > 0) setEditing(dayPosts[0]);
                else navigate("/compose");
              }}
            >
              <span class={`inline-flex items-center justify-center w-6 h-6 text-xs rounded-full ${
                isToday ? "bg-accent text-accent-foreground font-medium" : "text-foreground"
              }`}>
                {cell.day}
              </span>
              {dayPosts.length > 0 && (
                <div class="mt-1 space-y-0.5">
                  {dayPosts.slice(0, 3).map((p) => (
                    <div key={p.id} class="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] bg-muted truncate">
                      {p.channels.length > 0 && (
                        <span class="brand-mark w-1.5 h-1.5 rounded-full shrink-0" style={{ "--brand": p.channels[0].color }} />
                      )}
                      <span class="truncate">{p.content.slice(0, 25) || "Post"}</span>
                    </div>
                  ))}
                  {dayPosts.length > 3 && (
                    <span class="text-[10px] text-muted-foreground px-1">+{dayPosts.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <QuickEditDialog post={editing} onClose={() => setEditing(null)} navigate={navigate} />
    </div>
  );
}
