# Client Chat Platform — Embeddable Widget

This repo ships an embeddable chat widget served directly from the Worker.

## Add to any website (recommended)

Paste this just before `</body>`:

```html
<script
  src="https://client-chat-platform.evavo-studio.workers.dev/widget.js"
  data-api-base="https://client-chat-platform.evavo-studio.workers.dev"
  data-bot-id="digital-safegrid"
  data-title="Digital SafeGrid"
  data-theme="auto"            
  data-position="br"           
  data-brand-hex="#00e589"      
  data-open="false"            
  data-history="true"          
  data-max-history="60"        
  data-timeout-ms="25000"      
></script>
```

### Options (script `data-*`)

- `data-api-base` (required): Worker base URL
- `data-bot-id` (required): bot id configured in KV
- `data-title` (optional): header title (defaults to `cfg.siteName`)
- `data-theme`: `auto | light | dark`
- `data-position`: `br | bl | tr | tl`
- `data-brand-hex`: button + send button color
- `data-open`: open by default (`true/false`)
- `data-history`: persist chat locally (`true/false`)
- `data-max-history`: stored messages limit (5–100)
- `data-timeout-ms`: request timeout (5000–60000)

## React / Next.js

In `app/layout.tsx` or your root component:

```tsx
import Script from "next/script";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script
          src="https://client-chat-platform.evavo-studio.workers.dev/widget.js"
          strategy="afterInteractive"
          data-api-base="https://client-chat-platform.evavo-studio.workers.dev"
          data-bot-id="digital-safegrid"
          data-title="Digital SafeGrid"
        />
      </body>
    </html>
  );
}
```

## Notes

- The widget uses **Shadow DOM**, so it won't fight with Tailwind / site CSS.
- On screens `<= 520px` wide, the panel becomes a near full-screen sheet.
- The widget stores conversation history in `localStorage` per `{apiBase, botId}`.
