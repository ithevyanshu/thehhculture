/** DHH/CULTURE wordmark: heavy grotesk caps with a saffron slash. */
export function Wordmark({ className = '', inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span
      className={`font-logo leading-none tracking-[-0.02em] whitespace-nowrap uppercase ${inverted ? 'text-paper' : 'text-ink'} ${className}`}
      aria-label="DHH Culture"
    >
      DHH<span className="text-saffron">/</span>CULTURE
    </span>
  );
}
