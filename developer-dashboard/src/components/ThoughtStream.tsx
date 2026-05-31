// ThoughtStream.tsx
// "Ghostly" thinking status bar component with fading text animations
// Displays real-time AI intent streamed from testing-core backend

import { AnimatePresence, motion } from 'framer-motion';

interface ThoughtStreamProps {
  /** The current thought message from the AI engine */
  thought: string;
  /** Whether a test is currently running */
  isActive?: boolean;
}

/**
 * ThoughtStream - Monochrome "ghostly" status bar for AI thinking
 * 
 * Features:
 * - Fades out old text, slides up
 * - Fades in new text, slides up from bottom
 * - Pulsing dot indicator for "Active Reasoning"
 * - Monochrome aesthetic (white/light gray on dark)
 */
export default function ThoughtStream({ thought, isActive = false }: ThoughtStreamProps) {
  // Don't render if no thought and not active
  if (!thought && !isActive) {
    return null;
  }

  return (
    <div className="w-full px-4 py-2 bg-[#0D0D0D] border-b border-[#1F1F1F]">
      <div className="flex items-center gap-3">
        {/* Pulsing dot indicator */}
        <div className="relative flex-shrink-0">
          {/* Outer pulse ring */}
          <motion.div
            className="absolute -inset-1 rounded-full border border-white/20"
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.5, 0, 0.5],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
          {/* Inner solid dot */}
          <motion.div
            className="h-2 w-2 rounded-full bg-white"
            animate={{
              opacity: [1, 0.4, 1],
            }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </div>

        {/* Thought text container */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <AnimatePresence mode="wait">
            {thought ? (
              <motion.p
                key={thought}
                className="text-sm font-mono text-white/90 truncate"
                initial={{
                  opacity: 0,
                  y: 10,
                }}
                animate={{
                  opacity: 1,
                  y: 0,
                }}
                exit={{
                  opacity: 0,
                  y: -10,
                }}
                transition={{
                  duration: 0.2,
                  ease: "easeOut",
                }}
              >
                {thought}
              </motion.p>
            ) : (
              <motion.p
                key="waiting"
                className="text-sm font-mono text-white/40 italic"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  y: -10,
                }}
              >
                Initializing...
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* Active indicator label */}
        {isActive && (
          <div className="flex-shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
              Reasoning
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
