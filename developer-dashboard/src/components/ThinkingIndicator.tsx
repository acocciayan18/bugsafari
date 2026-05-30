// src/components/ThinkingIndicator.tsx
// Smart "Thinking" indicator that cycles through AI processing phrases

import { useEffect, useState } from 'react';

interface ThinkingIndicatorProps {
  isActive: boolean;
}

// Array of progressive AI thinking phrases
const THINKING_PHRASES = [
  'Engine is thinking...',
  'Fuzzing input fields...',
  'Evaluating target heuristics...',
  'Generating test payloads...',
  'Mapping interaction surface...',
  'Assessing security boundaries...',
];

const PHRASE_INTERVAL_MS = 1500;

export default function ThinkingIndicator({ isActive }: ThinkingIndicatorProps) {
  const [phraseIndex, setPhraseIndex] = useState(0);

  // Cycle through phrases every 1.5 seconds while active
  useEffect(() => {
    if (!isActive) {
      // Reset to first phrase when deactivated
      setPhraseIndex(0);
      return;
    }

    const intervalId = setInterval(() => {
      setPhraseIndex((prevIndex) => (prevIndex + 1) % THINKING_PHRASES.length);
    }, PHRASE_INTERVAL_MS);

    // CRUCIAL MEMORY CLEANUP: Clear interval on unmount or when isActive changes
    return () => clearInterval(intervalId);
  }, [isActive]);

  if (!isActive) {
    return null;
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-white">
      {/* Animated loader ring */}
      <div className="relative">
        {/* Outer pulse ring */}
        <div className="absolute h-16 w-16 animate-ping rounded-full border-2 border-emerald-400/30 opacity-75" />
        {/* Middle ring */}
        <div className="absolute left-1 top-1 h-14 w-14 animate-pulse rounded-full border-2 border-emerald-400/50" />
        {/* Inner spinning loader */}
        <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-emerald-400/80">
          <div className="h-3 w-3 animate-bounce rounded-full bg-emerald-400" />
        </div>
      </div>

      {/* Dynamic thinking phrase */}
      <div className="flex flex-col items-center gap-1">
        <p className="animate-pulse text-sm font-medium text-emerald-400">
          {THINKING_PHRASES[phraseIndex]}
        </p>
        <p className="text-xs text-slate-400">
          Please wait while the autonomous engine processes your request
        </p>
      </div>

      {/* Progress dots indicator */}
      <div className="mt-2 flex items-center gap-1.5">
        {THINKING_PHRASES.map((_, index) => (
          <span
            key={index}
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              index === phraseIndex
                ? 'bg-emerald-400'
                : index < phraseIndex
                ? 'bg-emerald-400/50'
                : 'bg-slate-600'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
