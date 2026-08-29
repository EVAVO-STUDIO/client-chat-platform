# Client Chat Platform — portable widget

The canonical portable client is `widget/embed.js`.

It is a small Shadow DOM chat primitive for websites that need the hardened `client-chat-platform` conversation service without taking on EVAVO's full first-party EVA character runtime.

## Recommended embed

Host the reviewed `widget/embed.js` file on a static HTTPS origin and load it near the end of the page:

```html
<script
  src="https://static.example.com/embed.js"
  data-api-base="https://client-chat-platform.example.workers.dev"
  data-bot-id="evavo"
  data-title="Ask EVAVO"
  data-greeting="Hi. What would you like help with?"
  data-contact="/contact"
  data-accent="#ff244e"
></script>
```

Do not put an administrator token or bot key in public HTML. Browser admission is controlled by the exact approved origins in the server-side bot configuration.

## Supported attributes

- `data-api-base` — HTTPS Worker origin. Local HTTP is accepted only for localhost development.
- `data-bot-id` — required configured bot identifier. Historical `data-bot` remains an alias.
- `data-title` — compact dialog title.
- `data-greeting` — initial assistant message.
- `data-contact` — safe relative path or public HTTPS contact destination.
- `data-accent` — six-digit hex accent colour. Defaults to EVAVO cherry `#ff244e`.
- `data-position="left"` — moves the launcher and panel from the default right side.
- `data-style-nonce` — optional host-provided CSP nonce for the Shadow DOM style element.

The current hardened widget does **not** expose the older undocumented `data-theme`, `data-brand-hex`, `data-open`, `data-history`, `data-max-history`, `data-timeout-ms`, `br/bl/tr/tl` position or browser `localStorage` history options. Those belonged to an earlier widget design and should not be copied into new integrations.

## Privacy and behaviour

The widget keeps a bounded in-memory conversation for the active page instance. It does not require persistent browser transcript storage.

A model may propose a follow-up, but the normal chat request cannot save a lead. The visitor sees the exact proposed email/message evidence and must explicitly choose the follow-up action before `POST /api/leads` can store the verified fields.

The widget also:

- bounds request and response sizes;
- handles offline and abort states;
- keeps keyboard and focus behaviour accessible;
- isolates its styles with Shadow DOM;
- never embeds server credentials;
- remains usable without avatar artwork or voice.

## EVA character presentation

`widget/super-eva-embed.js` is a compatibility experiment and is **not** the canonical EVA character renderer. It must not become a second independent animation system.

The production character, animation, lip-sync and approved-audio presentation contract belongs to `EVAVO-STUDIO/evavo-avatar-runtime`. The full EVAVO first-party EVA experience is composed by `EVAVO-STUDIO/next-website`.

For ordinary client websites, prefer `embed.js`. If a future portable character surface is required, consume a reviewed avatar-runtime release rather than recreating facial animation inside this repository.

See `docs/eva-product-boundary.md` and the repository root `README.md` for the current security and deployment contract.
