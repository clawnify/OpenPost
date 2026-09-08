import { useEffect } from "preact/hooks";
import { useApp } from "../context";
import { PLATFORM_LABELS } from "../types";
import { PlatformIcon } from "./platform-icon";

export function AnalyticsView() {
  const { stats, loadStats } = useApp();

  useEffect(() => { loadStats(); }, []);

  if (!stats) return <div class="p-6"><p class="text-muted-foreground">Loading...</p></div>;

  const maxChannelCount = Math.max(1, ...stats.per_channel.map((c: any) => c.post_count));
  const maxLabelCount = Math.max(1, ...stats.per_label.map((l: any) => l.post_count));
  const maxDailyCount = Math.max(1, ...stats.daily.map((d) => d.count));

  return (
    <div class="p-6 max-w-5xl mx-auto">
      <div class="mb-6">
        <h1 class="text-[1.375rem] font-semibold tracking-[-0.01em]">Analytics</h1>
      </div>

      {/* Overview */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { value: stats.total, label: "Total Posts" },
          { value: stats.published, label: "Published" },
          { value: stats.scheduled, label: "Scheduled" },
          { value: stats.drafts, label: "Drafts" },
        ].map(({ value, label }) => (
          <div key={label} class="card p-4">
            <div class="text-[1.25rem] font-semibold leading-none tabular">{value}</div>
            <div class="text-xs text-muted-foreground mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Posts per channel */}
      {stats.per_channel.length > 0 && (
        <section class="mb-8">
          <h2 class="text-base font-semibold mb-4">Posts per Channel</h2>
          <div class="card p-4 space-y-3">
            {stats.per_channel.map((ch: any) => (
              <div key={ch.id} class="flex items-center gap-3">
                <span class="w-32 text-sm truncate inline-flex items-center gap-1.5">
                  <PlatformIcon platform={ch.platform} size={12} />
                  {ch.name}
                  <span class="text-muted-foreground text-xs ml-1">
                    {PLATFORM_LABELS[ch.platform as keyof typeof PLATFORM_LABELS] || ch.platform}
                  </span>
                </span>
                <div class="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                  <div
                    class="brand-mark h-full rounded-full transition-all"
                    style={{ width: `${(ch.post_count / maxChannelCount) * 100}%`, "--brand": ch.color }}
                  />
                </div>
                <span class="text-sm font-medium w-8 text-right">{ch.post_count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Posts per label */}
      {stats.per_label.length > 0 && (
        <section class="mb-8">
          <h2 class="text-base font-semibold mb-4">Posts per Label</h2>
          <div class="card p-4 space-y-3">
            {stats.per_label.map((l: any) => (
              <div key={l.id} class="flex items-center gap-3">
                <span class="w-32 text-sm truncate">{l.name}</span>
                <div class="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all"
                    style={{ width: `${(l.post_count / maxLabelCount) * 100}%`, background: l.color }}
                  />
                </div>
                <span class="text-sm font-medium w-8 text-right">{l.post_count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Daily activity */}
      {stats.daily.length > 0 && (
        <section class="mb-8">
          <h2 class="text-base font-semibold mb-4">Daily Activity (Last 30 Days)</h2>
          <div class="card p-4">
            <div class="flex items-end gap-1 h-32">
              {stats.daily.map((d) => (
                <div key={d.day} class="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day}: ${d.count} posts`}>
                  <div
                    class="w-full bg-primary/80 rounded-t-sm min-h-[2px] transition-all"
                    style={{ height: `${(d.count / maxDailyCount) * 100}%` }}
                  />
                </div>
              ))}
            </div>
            <div class="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>{stats.daily[0]?.day.slice(5)}</span>
              <span>{stats.daily[stats.daily.length - 1]?.day.slice(5)}</span>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
