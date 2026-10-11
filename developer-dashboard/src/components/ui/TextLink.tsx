import { forwardRef, type ButtonHTMLAttributes } from 'react';

export type TextLinkTone = 'default' | 'muted';

interface TextLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: TextLinkTone;
}

// Inline text link rendered as a button (navigation/secondary action). Icon + label compose as children.
const TONE_CLASSES: Record<TextLinkTone, string> = {
  default: 'text-(--text-primary) hover:opacity-80 transition-opacity',
  muted: 'text-(--text-tertiary) hover:text-(--text-primary) transition-colors',
};

// Shared class for text links that must stay a router <Link> (navigation), where a <button> can't be used.
export function textLinkClass(tone: TextLinkTone = 'default'): string {
  return `inline-flex items-center gap-2 rounded-(--radius-sm) px-1 py-0.5 text-[13px] font-medium duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--border-focus) ${TONE_CLASSES[tone]}`;
}

/** Text-link button — a quiet inline link, not a filled action (use Button for those). */
export const TextLink = forwardRef<HTMLButtonElement, TextLinkProps>(function TextLink(
  { tone = 'default', type = 'button', className = '', children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${textLinkClass(tone)} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
