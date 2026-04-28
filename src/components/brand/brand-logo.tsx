/**
 * Renders a brand's logo with a CSS-only light/dark swap. Falls back to
 * whichever variant exists when only one is uploaded. Pure server
 * component (no theme JS) — works on share pages for unauthenticated
 * visitors as well as inside the app, because the swap rides on the
 * `.dark` class that next-themes sets on <html> before first paint.
 */
export function BrandLogo({
  light,
  dark,
  alt,
  className,
}: {
  light: string | null;
  dark: string | null;
  alt: string;
  className?: string;
}) {
  // Resolve fallbacks so a brand with only one variant still renders in
  // both modes — the alternative was "no logo in the mode they didn't
  // upload for," which is worse than showing the wrong-tone logo.
  const lightSrc = light ?? dark;
  const darkSrc = dark ?? light;
  if (!lightSrc && !darkSrc) return null;

  return (
    <>
      {lightSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={lightSrc}
          alt={alt}
          className={`${className ?? ""} dark:hidden`}
        />
      )}
      {darkSrc && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={darkSrc}
          alt={alt}
          className={`${className ?? ""} hidden dark:block`}
        />
      )}
    </>
  );
}
