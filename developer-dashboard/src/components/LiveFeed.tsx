// src/components/LiveFeed.tsx

interface LiveFeedProps {
  frame: string | null;
  isConnected: boolean;
  isTestRunning: boolean;
  currentUrl: string;
}

export default function LiveFeed({ frame, isConnected, isTestRunning, currentUrl }: LiveFeedProps) {
  return (
    <div className="w-full max-w-5xl shrink-0 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#F7F7F8] shadow-[0_18px_60px_rgba(0,0,0,0.08)]">
      {/* BROWSER HEADER */}
      <div className="flex items-center gap-4 border-b border-[#E5E7EB] bg-white px-4 py-2 sm:px-5">
        {/* Window Controls */}
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#EF4444]" aria-hidden="true" />
          <span className="h-3 w-3 rounded-full bg-[#F59E0B]" aria-hidden="true" />
          <span className="h-3 w-3 rounded-full bg-[#10A37F]" aria-hidden="true" />
        </div>

        {/* Navigation Buttons (Purely Visual) */}
        <div className="flex items-center gap-3 text-[#9CA3AF]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        </div>

        {/* URL BAR */}
        <div className="flex flex-1 items-center gap-2 rounded-lg bg-[#F3F4F6] px-3 py-1.5 text-xs text-[#374151]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10A37F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <input
            className="truncate bg-transparent outline-none w-full font-medium"
            readOnly
            value={currentUrl || 'about:blank'}
          />
        </div>


        {/* ENGINE STATUS */}
        <div className="flex items-center gap-2 rounded-full bg-[#F3F4F6] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#4B5563]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isTestRunning ? 'animate-pulse bg-[#10A37F]' : isConnected ? 'bg-[#9CA3AF]' : 'bg-[#EF4444]'
            }`}
            aria-hidden="true"
          />
          {isTestRunning ? 'Live' : isConnected ? 'Ready' : 'Offline'}
        </div>
      </div>

      {/* VIEWPORT */}
      <div className="aspect-16/10 bg-[#111827]">
        {frame ? (
          <img 
            src={frame.startsWith('data:') ? frame : `data:image/jpeg;base64,${frame}`} 
            alt="Live Engine Vision" 
            className="h-full w-full object-contain" 
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
             <div className="animate-pulse flex flex-col items-center">
                <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[#2F3848] bg-[#1F2937] text-sm font-semibold mb-2">
                  BS
                </div>
                <p className="text-sm font-medium text-[#D1D5DB]">Awaiting visual telemetry stream...</p>
                <p className="text-xs text-[#6B7280]">Connect the engine to start exploration.</p>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}