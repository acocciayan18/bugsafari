interface ControlPanelProps {
  targetUrl: string;
  setTargetUrl: (url: string) => void;
  isConnected: boolean;
  isTestRunning: boolean;
  engineStatus: string;
  onLaunch: () => void;
}

export default function ControlPanel({
  targetUrl,
  setTargetUrl,
  isConnected,
  isTestRunning,
  engineStatus,
  onLaunch,
}: ControlPanelProps) {
  const isLaunchDisabled = !isConnected || isTestRunning || targetUrl.trim().length === 0;

  return (
    <footer className="sticky bottom-0 bg-white pb-5 pt-3">
      <div className="mx-auto w-full max-w-3xl">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onLaunch();
          }}
          className="flex min-h-16 items-center gap-3 rounded-2xl border border-[#D9D9E3] bg-white px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.08)] transition-shadow focus-within:shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
        >
          <label htmlFor="target-url" className="sr-only">
            Target URL
          </label>

          <input
            id="target-url"
            type="url"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            disabled={isTestRunning}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-[#111827] outline-none placeholder:text-[#9CA3AF] disabled:cursor-not-allowed disabled:text-[#9CA3AF]"
            placeholder="Paste a staging URL for BugSafari to explore"
          />

          <button
            type="submit"
            disabled={isLaunchDisabled}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-lg font-semibold transition-colors ${
              isLaunchDisabled
                ? 'cursor-not-allowed bg-[#F3F4F6] text-[#9CA3AF]'
                : 'bg-[#111827] text-white hover:bg-[#2F2F2F]'
            }`}
            aria-label={isTestRunning ? 'Exploration running' : 'Launch exploration'}
            title={isTestRunning ? 'Exploration running' : 'Launch exploration'}
          >
            {isTestRunning ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#D1D5DB] border-t-[#111827]" />
            ) : (
              <span aria-hidden="true">&gt;</span>
            )}
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 px-2 text-center text-xs text-[#6B7280]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isConnected ? 'bg-[#10A37F]' : 'bg-[#EF4444]'
            }`}
            aria-hidden="true"
          />
          <span className="truncate">{engineStatus}</span>
        </div>
      </div>
    </footer>
  );
}