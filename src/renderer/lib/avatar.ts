const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="avatar">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <circle cx="64" cy="52" r="20" fill="rgba(255,255,255,0.85)"/>
  <path d="M26 110c6-20 23-34 38-34s32 14 38 34" fill="rgba(255,255,255,0.85)"/>
</svg>`;

export const AVATAR_FALLBACK_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(FALLBACK_SVG)}`;

export const onAvatarImgError = (ev: Event) => {
  const img = ev.target as HTMLImageElement | null;
  if (!img) return;
  if (img.dataset.rsAvatarFallback === "1") return;
  img.dataset.rsAvatarFallback = "1";
  img.removeAttribute("srcset");
  img.src = AVATAR_FALLBACK_DATA_URI;
};

