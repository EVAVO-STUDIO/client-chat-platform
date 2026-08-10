# SUPER EVA standalone widget

`widget/super-eva-embed.js` is the upgraded animated EVA chat surface for this repository. It uses the existing bounded `/api/chat` endpoint, renders a self-contained Shadow DOM avatar, keeps text primary, provides opt-in Australian browser speech, stops immediately on Escape/close/page hide, and consumes `eva_super_presentation_v1` when a trusted backend includes it.

Without a signed presentation, the widget creates a local presentation labelled `system-fallback`; it does not claim the final EVA voice, durable storage or a signed private-owner turn. When `approved-audio` is returned, playback requires a valid HTTPS audio reference. The widget never inserts assistant text as HTML.

Example:

```html
<script
  src="https://static.example.com/super-eva-embed.js"
  data-api-base="https://client-chat-platform.example.workers.dev"
  data-bot-id="evavo"
  data-title="SUPER EVA"
  data-voice="on"
  data-accent="#ff244e"
></script>
```

The existing `widget/embed.js` remains available for compatibility. Run `npm --prefix worker run check` to include the SUPER EVA syntax and security contract gate.
