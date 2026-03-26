/**
 * Avatar Component
 * Displays user avatar image with fallback to initials.
 */
import { cn } from '@/lib/utils';

interface AvatarProps {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function Avatar({ src, name = '', size = 32, className }: AvatarProps) {
  const initials = getInitials(name) || '?';

  return (
    <div
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={(e) => {
            // Hide broken image, show initials fallback
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span
          className="text-muted-foreground font-medium select-none"
          style={{ fontSize: size * 0.4 }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
