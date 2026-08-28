export default function Thumb({ image, size = 0 }: { image: string; size?: number }) {
  const [bg, emoji] = (image || '#334155|📦').split('|');
  const style: React.CSSProperties = { background: `linear-gradient(135deg, ${bg}, #0b0f14)` };
  if (size) { style.width = size; style.height = size; style.fontSize = size * 0.5; }
  return <div className="thumb" style={style}><span>{emoji}</span></div>;
}
