import { Disc3 } from 'lucide-react';
import { useState } from 'react';

interface PlaylistArtworkProps {
  src?: string;
  alt: string;
  sizeClass?: string;
}

export function PlaylistArtwork({
  src,
  alt,
  sizeClass = 'w-12 h-12',
}: PlaylistArtworkProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`${sizeClass} shrink-0 rounded-md bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-400`}
        aria-hidden="true"
      >
        <Disc3 className="w-5 h-5" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${sizeClass} shrink-0 rounded-md object-cover border border-zinc-200 bg-zinc-100`}
    />
  );
}
