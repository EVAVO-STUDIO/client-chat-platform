# EVA product boundary

`client-chat-platform` is the conversation and external-embed layer of EVA Chat.

It owns request admission, approved knowledge, provider execution boundaries, explicit visitor-approved follow-up, administration, and the portable Shadow DOM widget.

It does **not** own EVA character art, animation semantics, lip-sync assets, or the EVAVO first-party page layout. Those belong to `EVAVO-STUDIO/evavo-avatar-runtime` and `EVAVO-STUDIO/next-website` respectively.

## Integration contract

The preferred product flow is:

```text
visitor
  -> next-website first-party UI or client-chat-platform embed
  -> client-chat-platform admitted chat response
  -> next-website response admission/presentation mapping
  -> evavo-avatar-runtime presentation state
```

The portable widget must remain usable without avatar assets or voice. The EVAVO first-party experience may be richer, but it must not weaken this repository's origin, consent, storage, request-size, response-size, timeout, knowledge-fetch or secret boundaries.

## Design posture

The embedded widget is a robust client primitive rather than the canonical EVA showcase. Keep it compact, accessible and themeable without turning it into a second independent EVA design system.

The EVAVO website should carry the full character-led composition. Client embeds can progressively adopt controlled branding tokens while preserving Shadow DOM isolation and keyboard/focus behaviour.
