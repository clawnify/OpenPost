import { useApp } from "../context";

export function ErrorBanner() {
  const { error, clearError } = useApp();
  if (!error) return null;
  return (
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-destructive-solid text-white px-4 py-2.5 rounded-md flex items-center gap-3 text-sm z-50 max-w-md">
      <span class="flex-1">{error}</span>
      <button
        onClick={clearError}
        class="text-white/80 hover:text-white text-lg leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
