/** Pulsing dot attention indicator used in JobCard and ProjectManager.
 *  Uses semantic-attention (blue) to avoid clashing with the orange planning column. */
export function NotificationBadge({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  return (
    <span className={`relative flex ${dim} shrink-0 text-semantic-attention`}>
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-content-primary opacity-50" />
      <span className={`relative inline-flex rounded-full ${dim} bg-content-primary`} />
    </span>
  );
}
