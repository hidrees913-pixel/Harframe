import { useState } from 'react';

interface HarFrameLogoProps {
  className?: string;
}

export function HarFrameLogo({ className = 'h-9 w-auto' }: HarFrameLogoProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <span className="inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight text-slate-900">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-purple-600 text-xs font-extrabold text-white">
          HF
        </span>
        HARFRAME
      </span>
    );
  }

  return (
    <picture>
      <source srcSet="/assets/logo-harframe-sm.webp" type="image/webp" />
      <img
        src="/assets/aistudio/Logo_f2c9be3b.png"
        alt="HarFrame"
        width={52}
        height={52}
        decoding="async"
        fetchPriority="high"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`object-contain select-none ${className}`}
      />
    </picture>
  );
}
