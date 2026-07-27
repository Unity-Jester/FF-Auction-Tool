const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#d9ff48"/>
  <path d="M18 44 28 18h8l10 26h-8l-2-6H27l-2 6h-7Zm11-13h5l-2.5-8L29 31Z" fill="#152000"/>
</svg>`;

export function GET(): Response {
  return new Response(icon, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "image/svg+xml",
    },
  });
}
