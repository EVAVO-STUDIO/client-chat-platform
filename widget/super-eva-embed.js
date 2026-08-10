// SUPER EVA standalone chat widget for client-chat-platform.
// Loads independently from the legacy widget and uses the existing /api/chat contract.
(() => {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  const MAX_RESPONSE_BYTES = 65_536;
  const MAX_RESPONSE_CHUNKS = 128;
  const CONTROL_PATTERN =
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
  const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
  const PRESENTATION_ID_PATTERN =
    /^eva_presentation_[A-Za-z0-9_-]{8,96}$/u;
  const MESSAGE_ID_PATTERN = /^eva_message_[A-Za-z0-9_-]{8,96}$/u;
  const STATES = new Set([
    "ready",
    "listening",
    "thinking",
    "speaking",
    "working",
    "success",
    "error",
    "stopped",
  ]);
  const GESTURES = new Set([
    "idle",
    "acknowledge",
    "explain",
    "emphasise",
    "alert",
  ]);
  const EMOTIONS = new Set([
    "neutral",
    "warm",
    "focused",
    "confident",
    "concerned",
  ]);
  const OUTPUT_MODES = new Set([
    "normal",
    "quiet",
    "discreet",
    "silent",
  ]);

  const bounded = (value, fallback, maximum) =>
    (String(value || "").trim() || fallback).slice(0, maximum);
  const record = (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  const exactKeys = (value, expected) => {
    const actual = Object.keys(value).sort();
    const required = [...expected].sort();
    return (
      actual.length === required.length &&
      actual.every((key, index) => key === required[index])
    );
  };
  const canonicalText = (value, maximum, allowEmpty = false) =>
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maximum &&
    value.normalize("NFC") === value &&
    !CONTROL_PATTERN.test(value);
  const canonicalTimestamp = (value) => {
    if (typeof value !== "string" || value.length > 40) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  };
  const finiteBetween = (value, minimum, maximum) =>
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum;
  const safeOrigin = (value) => {
    try {
      const url = new URL(String(value || ""));
      const local = ["localhost", "127.0.0.1", "::1"].includes(
        url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
      );
      if (
        (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !["", "/"].includes(url.pathname)
      ) {
        return null;
      }
      return url.origin;
    } catch {
      return null;
    }
  };
  const bytesToHex = (value) =>
    [...new Uint8Array(value)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  const sha256 = async (value) => {
    if (!globalThis.crypto?.subtle) {
      throw new Error("presentation_hash_unavailable");
    }
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return bytesToHex(digest);
  };
  const compactSpeech = (text) => {
    const cleaned = String(text || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, "$1")
      .replace(/\b(?:https?:\/\/|www\.)\S+/g, " ")
      .replace(/\*\*|__|~~|`/g, "")
      .replace(/[—–]/g, ",")
      .replace(/\s+/g, " ")
      .trim();
    const safe = cleaned || "The full response is available on screen.";
    const words = safe.split(/\s+/g);
    return words.length > 24
      ? `${words.slice(0, 24).join(" ")}…`
      : safe;
  };

  const botId = bounded(
    script.getAttribute("data-bot-id") || script.getAttribute("data-bot"),
    "",
    64,
  );
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(botId)) return;
  const scriptOrigin = (() => {
    try {
      return new URL(script.src, location.href).origin;
    } catch {
      return "";
    }
  })();
  const base = safeOrigin(script.getAttribute("data-api-base") || scriptOrigin);
  if (!base) return;

  const title = bounded(script.getAttribute("data-title"), "SUPER EVA", 80);
  const greeting = bounded(
    script.getAttribute("data-greeting"),
    "Hi. I’m EVA. What would you like help with?",
    500,
  );
  const voiceEnabled = script.getAttribute("data-voice") === "on";
  const position =
    script.getAttribute("data-position") === "left" ? "left" : "right";
  const accent = /^#[a-f0-9]{6}$/i.test(
    script.getAttribute("data-accent") || "",
  )
    ? script.getAttribute("data-accent")
    : "#ff244e";
  const registry =
    window.__EVAVO_SUPER_EVA_WIDGETS__ instanceof Set
      ? window.__EVAVO_SUPER_EVA_WIDGETS__
      : new Set();
  window.__EVAVO_SUPER_EVA_WIDGETS__ = registry;
  const registryKey = `${base}|${botId}`;
  if (registry.has(registryKey)) return;
  registry.add(registryKey);

  const host = document.createElement("div");
  host.setAttribute("data-evavo-super-eva", botId);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;--eva:${accent};--ink:#06070a;--panel:#0c0f15;--card:#121722;--line:#273141;--text:#f6f7f9;--muted:#8d98a8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color-scheme:dark}
    *,*::before,*::after{box-sizing:border-box}button,textarea{font:inherit}button:focus-visible,textarea:focus-visible{outline:3px solid #ffd1da;outline-offset:2px}
    .launcher{position:fixed;z-index:2147483000;bottom:18px;${position}:18px;display:flex;align-items:center;gap:10px;min-height:52px;border:1px solid color-mix(in srgb,var(--eva) 64%,white 14%);border-radius:999px;background:#0b0e14;color:var(--text);padding:6px 15px 6px 7px;box-shadow:0 20px 56px rgba(0,0,0,.48);cursor:pointer}
    .launcher-avatar,.avatar{position:relative;display:grid;place-items:center;overflow:hidden;border-radius:50%;background:radial-gradient(circle at 44% 34%,#fff 0 4%,#ffc1cf 5% 12%,var(--eva) 13% 34%,#4c0719 64%,#050609 100%);box-shadow:inset 0 0 24px rgba(255,255,255,.18),0 0 28px color-mix(in srgb,var(--eva) 38%,transparent)}
    .launcher-avatar{width:38px;height:38px}.launcher-label{font-size:12px;font-weight:900;letter-spacing:.06em}.avatar{width:108px;height:108px;flex:0 0 auto;transition:transform .25s ease,box-shadow .25s ease}
    .face{position:relative;width:56%;height:50%;border-radius:46% 46% 50% 50%;background:linear-gradient(165deg,#ffd6cc,#be716b);box-shadow:inset 0 -8px 18px rgba(83,25,28,.28)}
    .eye{position:absolute;top:35%;width:8px;height:6px;border-radius:50%;background:#241116;transition:transform .16s ease}.eye.left{left:25%}.eye.right{right:25%}
    .mouth{position:absolute;left:50%;bottom:20%;width:20px;height:4px;transform:translateX(-50%);border-radius:0 0 18px 18px;border-bottom:3px solid #6c2630;transition:height .12s ease,border-radius .12s ease}
    .state-speaking .mouth{height:13px;border:3px solid #6c2630;background:#2d0b10;animation:eva-mouth .32s ease-in-out infinite alternate}.state-listening .eye{transform:scaleY(1.35)}.state-thinking .avatar{animation:eva-think 2.4s ease-in-out infinite}.state-error .avatar{box-shadow:inset 0 0 24px rgba(255,255,255,.12),0 0 0 3px #ff6d86}.state-success .mouth{height:9px;border-radius:0 0 18px 18px}
    .avatar[data-emotion="warm"]{transform:scale(1.025)}.avatar[data-emotion="confident"]{box-shadow:inset 0 0 24px rgba(255,255,255,.22),0 0 34px color-mix(in srgb,var(--eva) 54%,transparent)}.avatar[data-emotion="concerned"]{box-shadow:inset 0 0 24px rgba(255,255,255,.12),0 0 0 2px #ff8097}.avatar[data-gesture="emphasise"]{transform:scale(1.045)}
    .panel{position:fixed;z-index:2147483000;bottom:82px;${position}:18px;width:min(430px,calc(100vw - 24px));height:min(690px,calc(100dvh - 106px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,#111620,#080a0f);color:var(--text);box-shadow:0 32px 100px rgba(0,0,0,.62)}.panel[hidden]{display:none}
    .head{display:flex;align-items:center;gap:14px;padding:18px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 18% 0,color-mix(in srgb,var(--eva) 18%,transparent),transparent 48%)}
    .identity{min-width:0;flex:1}.eyebrow{margin:0 0 5px;color:var(--eva);font-size:9px;font-weight:950;letter-spacing:.18em;text-transform:uppercase}.title{margin:0;font-size:17px;font-weight:950}.state{margin:5px 0 0;color:var(--muted);font-size:11px}.close,.send,.voice{border:1px solid var(--line);border-radius:12px;background:#171d28;color:var(--text);cursor:pointer}.close{width:40px;height:40px;font-size:20px}.voice{min-height:34px;padding:7px 10px;font-size:10px;font-weight:900;text-transform:uppercase}.voice[aria-pressed="true"]{border-color:var(--eva);color:#fff}.voice:disabled{opacity:.38;cursor:not-allowed}
    .log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:11px}.row{display:flex}.row.user{justify-content:flex-end}.bubble{max-width:86%;border:1px solid var(--line);border-radius:16px;padding:11px 13px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.5}.user .bubble{background:var(--eva);border-color:var(--eva);color:var(--ink);border-bottom-right-radius:5px}.assistant .bubble{background:var(--card);border-bottom-left-radius:5px}
    .meta{min-height:31px;padding:6px 16px 11px;color:var(--muted);font-size:10px;line-height:1.45}.meta.error{color:#ff9aac}.composer{border-top:1px solid var(--line);padding:12px;background:#10141d}.input-row{display:flex;align-items:flex-end;gap:8px}.input{flex:1;min-height:44px;max-height:130px;resize:none;border:1px solid var(--line);border-radius:13px;background:#090c12;color:var(--text);padding:11px;outline:none}.send{width:46px;height:46px;border:0;background:var(--eva);color:var(--ink);font-size:18px;font-weight:950}.send:disabled{opacity:.45;cursor:not-allowed}.privacy{margin:7px 2px 0;color:#6f7988;font-size:9px}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @keyframes eva-mouth{from{height:5px}to{height:15px}}@keyframes eva-think{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.025)}}
    @media(max-width:520px){.launcher{bottom:12px;${position}:12px}.panel{bottom:72px;${position}:12px;width:calc(100vw - 24px);height:min(720px,calc(100dvh - 90px))}}
    @media(prefers-reduced-motion:reduce){.state-speaking .mouth,.state-thinking .avatar{animation:none}.avatar{transition:none}}
  `;

  const instanceId = `super-eva-${
    globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
  }`;
  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  launcher.setAttribute("aria-controls", instanceId);
  launcher.setAttribute("aria-label", `Open ${title}`);
  const launcherAvatar = document.createElement("span");
  launcherAvatar.className = "launcher-avatar";
  const launcherLabel = document.createElement("span");
  launcherLabel.className = "launcher-label";
  launcherLabel.textContent = "Ask EVA";
  launcher.append(launcherAvatar, launcherLabel);

  const panel = document.createElement("section");
  panel.id = instanceId;
  panel.className = "panel state-ready";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const head = document.createElement("header");
  head.className = "head";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.dataset.gesture = "idle";
  avatar.dataset.emotion = "neutral";
  const face = document.createElement("span");
  face.className = "face";
  const leftEye = document.createElement("span");
  leftEye.className = "eye left";
  const rightEye = document.createElement("span");
  rightEye.className = "eye right";
  const mouth = document.createElement("span");
  mouth.className = "mouth";
  face.append(leftEye, rightEye, mouth);
  avatar.append(face);
  const identity = document.createElement("div");
  identity.className = "identity";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "EVAVO assistant";
  const heading = document.createElement("h2");
  heading.className = "title";
  heading.id = `${instanceId}-title`;
  heading.textContent = title;
  panel.setAttribute("aria-labelledby", heading.id);
  const stateLabel = document.createElement("p");
  stateLabel.className = "state";
  stateLabel.textContent = "Ready";
  identity.append(eyebrow, heading, stateLabel);
  const voice = document.createElement("button");
  voice.className = "voice";
  voice.type = "button";
  voice.textContent = "Voice";
  voice.disabled = !("speechSynthesis" in window);
  voice.setAttribute("aria-pressed", voiceEnabled ? "true" : "false");
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close SUPER EVA chat");
  head.append(avatar, identity, voice, close);

  const log = document.createElement("div");
  log.className = "log";
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-relevant", "additions text");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.setAttribute("role", "status");
  meta.setAttribute("aria-live", "polite");
  const composer = document.createElement("div");
  composer.className = "composer";
  const row = document.createElement("div");
  row.className = "input-row";
  const label = document.createElement("label");
  label.className = "sr";
  label.textContent = "Message";
  const input = document.createElement("textarea");
  input.className = "input";
  input.rows = 1;
  input.maxLength = 2_000;
  input.placeholder = "Ask EVA…";
  label.htmlFor = `${instanceId}-input`;
  input.id = label.htmlFor;
  input.setAttribute("enterkeyhint", "send");
  const send = document.createElement("button");
  send.className = "send";
  send.type = "button";
  send.textContent = "↑";
  send.setAttribute("aria-label", "Send message");
  const privacy = document.createElement("p");
  privacy.className = "privacy";
  privacy.textContent =
    "Text is primary. Voice is optional. Never share passwords or credentials.";
  row.append(label, input, send);
  composer.append(row, privacy);
  panel.append(head, log, meta, composer);
  shadow.append(style, launcher, panel);
  document.body.appendChild(host);

  const messages = [];
  let busy = false;
  let enabledVoice = voiceEnabled && "speechSynthesis" in window;
  let controller = null;
  let speechRevision = 0;

  const setState = (state, detail, presentation = null) => {
    for (const value of STATES) {
      panel.classList.toggle(`state-${value}`, value === state);
    }
    if (presentation) {
      avatar.dataset.gesture = presentation.avatar.gesture;
      avatar.dataset.emotion = presentation.avatar.emotion;
      avatar.dataset.animationProfile = presentation.avatar.animationProfile;
    }
    stateLabel.textContent =
      detail || state.charAt(0).toUpperCase() + state.slice(1);
  };
  const setMeta = (text, error = false) => {
    meta.textContent = text || "";
    meta.classList.toggle("error", error);
  };
  const add = (role, text) => {
    const content = String(text || "")
      .trim()
      .slice(0, role === "user" ? 2_000 : 8_000);
    if (!content) return;
    const messageRow = document.createElement("div");
    messageRow.className = `row ${role === "user" ? "user" : "assistant"}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    messageRow.append(bubble);
    log.append(messageRow);
    messages.push({
      role: role === "user" ? "user" : "assistant",
      content,
    });
    if (messages.length > 20) messages.splice(0, messages.length - 20);
    log.scrollTop = log.scrollHeight;
  };
  const stopVoice = (showStopped = true) => {
    speechRevision += 1;
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    if (showStopped) setState("stopped", "Stopped");
  };

  const localPresentation = async (text) => {
    const spokenText = compactSpeech(text);
    const contentSha256 = await sha256(spokenText);
    const now = new Date();
    const seed = `${Date.now().toString(36)}${contentSha256.slice(0, 20)}`;
    return Object.freeze({
      contractVersion: "eva_super_presentation_v1",
      requestId: `eva_widget_${seed}`,
      presentationId: `eva_presentation_${seed}`,
      conversationId: `eva_widget_conversation_${botId}`,
      messageId: `eva_message_${seed}`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      text,
      spokenText,
      state: enabledVoice ? "speaking" : "success",
      avatar: Object.freeze({
        characterId: "eva-female",
        manifestRef: "evavo-avatar://eva-female/v1",
        state: enabledVoice ? "speaking" : "success",
        gesture: "explain",
        emotion: "warm",
        animationProfile: "natural",
        reducedMotionFallback: "static-breath",
      }),
      voice: Object.freeze({
        profileId: "eva-original",
        language: "en-AU",
        delivery: "system-fallback",
        admissionStatus: "fallback",
        rightsStatus: "not-required-for-system-fallback",
        outputMode: "quiet",
        rate: 0.92,
        pitch: 1.01,
        volume: 0.44,
        contentSha256,
        audioRef: null,
        manifestRef: null,
      }),
      wearable: Object.freeze({
        enabled: false,
        spokenText,
        voiceId: "eva-original",
        outputMode: "quiet",
        interruptible: true,
        sensitivity: "public",
        audioRoute: "unknown",
        peopleNearby: false,
      }),
      storage: Object.freeze({
        reference: `evavo-storage://super-eva/presentations/${contentSha256}`,
        retention: "ephemeral",
        status: "not-requested",
        expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
        contentSha256,
        storeText: false,
        storeAudioByReference: true,
        backupState: "none",
      }),
      provenance: Object.freeze({
        producer: "EVAVO-STUDIO/client-chat-platform",
        avatarRuntime: "EVAVO-STUDIO/evavo-avatar-runtime",
        audioStudio: "EVAVO-STUDIO/evavo-audio-studio",
        storage: "EVAVO-STUDIO/evavo-storage",
        glassesRuntime: "EVAVO-STUDIO/evavo-glasses",
      }),
    });
  };

  const parsePresentation = async (value, fallbackText) => {
    const root = record(value);
    const avatarValue = record(root?.avatar);
    const voiceValue = record(root?.voice);
    const wearableValue = record(root?.wearable);
    const storageValue = record(root?.storage);
    const provenanceValue = record(root?.provenance);
    try {
      if (
        !root ||
        !exactKeys(root, [
          "avatar",
          "contractVersion",
          "conversationId",
          "createdAt",
          "expiresAt",
          "messageId",
          "presentationId",
          "provenance",
          "requestId",
          "spokenText",
          "state",
          "storage",
          "text",
          "voice",
          "wearable",
        ]) ||
        root.contractVersion !== "eva_super_presentation_v1" ||
        typeof root.requestId !== "string" ||
        root.requestId.length < 8 ||
        root.requestId.length > 160 ||
        typeof root.presentationId !== "string" ||
        !PRESENTATION_ID_PATTERN.test(root.presentationId) ||
        typeof root.conversationId !== "string" ||
        root.conversationId.length < 8 ||
        root.conversationId.length > 160 ||
        typeof root.messageId !== "string" ||
        !MESSAGE_ID_PATTERN.test(root.messageId) ||
        !canonicalTimestamp(root.createdAt) ||
        !canonicalTimestamp(root.expiresAt) ||
        Date.parse(root.expiresAt) <= Date.now() ||
        !canonicalText(root.text, 16_000) ||
        root.text !== fallbackText ||
        !canonicalText(root.spokenText, 8_000, true) ||
        !STATES.has(root.state) ||
        !avatarValue ||
        !voiceValue ||
        !wearableValue ||
        !storageValue ||
        !provenanceValue
      ) {
        throw new Error("presentation_invalid");
      }
      if (
        avatarValue.characterId !== "eva-female" ||
        avatarValue.manifestRef !== "evavo-avatar://eva-female/v1" ||
        avatarValue.state !== root.state ||
        !GESTURES.has(avatarValue.gesture) ||
        !EMOTIONS.has(avatarValue.emotion) ||
        !["minimal", "natural", "expressive"].includes(
          avatarValue.animationProfile,
        ) ||
        avatarValue.reducedMotionFallback !== "static-breath"
      ) {
        throw new Error("presentation_avatar_invalid");
      }
      if (
        voiceValue.profileId !== "eva-original" ||
        voiceValue.language !== "en-AU" ||
        !["approved-audio", "system-fallback", "silent"].includes(
          voiceValue.delivery,
        ) ||
        !["approved", "fallback", "unavailable"].includes(
          voiceValue.admissionStatus,
        ) ||
        ![
          "verified",
          "not-required-for-system-fallback",
          "unverified",
        ].includes(voiceValue.rightsStatus) ||
        !OUTPUT_MODES.has(voiceValue.outputMode) ||
        !finiteBetween(voiceValue.rate, 0.5, 2) ||
        !finiteBetween(voiceValue.pitch, 0.5, 2) ||
        !finiteBetween(voiceValue.volume, 0, 1) ||
        typeof voiceValue.contentSha256 !== "string" ||
        !SHA256_PATTERN.test(voiceValue.contentSha256) ||
        (voiceValue.audioRef !== null &&
          (typeof voiceValue.audioRef !== "string" ||
            !voiceValue.audioRef.startsWith("evavo-storage://"))) ||
        (voiceValue.manifestRef !== null &&
          (typeof voiceValue.manifestRef !== "string" ||
            !voiceValue.manifestRef.startsWith("evavo-audio://")))
      ) {
        throw new Error("presentation_voice_invalid");
      }
      if (
        typeof wearableValue.enabled !== "boolean" ||
        wearableValue.spokenText !== root.spokenText ||
        wearableValue.voiceId !== "eva-original" ||
        wearableValue.outputMode !== voiceValue.outputMode ||
        wearableValue.interruptible !== true ||
        !["public", "personal", "sensitive", "restricted"].includes(
          wearableValue.sensitivity,
        ) ||
        !["open-ear", "earpiece", "speaker", "unknown"].includes(
          wearableValue.audioRoute,
        ) ||
        typeof wearableValue.peopleNearby !== "boolean"
      ) {
        throw new Error("presentation_wearable_invalid");
      }
      if (
        typeof storageValue.reference !== "string" ||
        !storageValue.reference.startsWith("evavo-storage://") ||
        !["ephemeral", "session", "kept", "archival"].includes(
          storageValue.retention,
        ) ||
        !["not-requested", "planned", "verified"].includes(
          storageValue.status,
        ) ||
        storageValue.contentSha256 !== voiceValue.contentSha256 ||
        storageValue.storeText !== false ||
        storageValue.storeAudioByReference !== true ||
        !["none", "queued", "verified"].includes(
          storageValue.backupState,
        )
      ) {
        throw new Error("presentation_storage_invalid");
      }
      if (
        ![
          "EVAVO-STUDIO/client-chat-platform",
          "EVAVO-STUDIO/chatbot-backend",
          "EVAVO-STUDIO/super-admin-ai-agent",
        ].includes(provenanceValue.producer) ||
        provenanceValue.avatarRuntime !==
          "EVAVO-STUDIO/evavo-avatar-runtime" ||
        provenanceValue.audioStudio !==
          "EVAVO-STUDIO/evavo-audio-studio" ||
        provenanceValue.storage !== "EVAVO-STUDIO/evavo-storage" ||
        provenanceValue.glassesRuntime !== "EVAVO-STUDIO/evavo-glasses"
      ) {
        throw new Error("presentation_provenance_invalid");
      }
      if (
        (voiceValue.delivery === "approved-audio" &&
          (voiceValue.admissionStatus !== "approved" ||
            voiceValue.rightsStatus !== "verified" ||
            voiceValue.audioRef === null ||
            voiceValue.manifestRef === null ||
            storageValue.status !== "verified")) ||
        (voiceValue.delivery === "system-fallback" &&
          (voiceValue.admissionStatus !== "fallback" ||
            voiceValue.rightsStatus !==
              "not-required-for-system-fallback" ||
            voiceValue.audioRef !== null ||
            voiceValue.manifestRef !== null)) ||
        (voiceValue.delivery === "silent" &&
          (voiceValue.outputMode !== "silent" ||
            voiceValue.volume !== 0 ||
            root.spokenText !== "" ||
            wearableValue.enabled))
      ) {
        throw new Error("presentation_binding_invalid");
      }
      if ((await sha256(root.spokenText)) !== voiceValue.contentSha256) {
        throw new Error("presentation_hash_invalid");
      }
      return Object.freeze({ presentation: root, verified: true });
    } catch {
      return Object.freeze({
        presentation: await localPresentation(fallbackText),
        verified: false,
      });
    }
  };

  const speak = (presentation) => {
    setState(
      presentation.avatar.state,
      presentation.avatar.state === "speaking" ? "Speaking" : "Ready",
      presentation,
    );
    if (
      !enabledVoice ||
      presentation.voice.delivery === "silent" ||
      !presentation.spokenText
    ) {
      setState("success", "Ready", presentation);
      return;
    }
    stopVoice(false);
    if (presentation.voice.delivery === "approved-audio") {
      setMeta(
        "Approved EVA audio is verified by EVAVO Storage reference but needs an authenticated resolver before playback. Text remains available.",
      );
      setState("success", "Ready · audio resolver required", presentation);
      return;
    }
    if (!("speechSynthesis" in window)) {
      setState("success", "Ready · voice unavailable", presentation);
      return;
    }
    const revision = ++speechRevision;
    const utterance = new SpeechSynthesisUtterance(presentation.spokenText);
    const candidates = window.speechSynthesis
      .getVoices()
      .filter((item) => item.lang.toLowerCase() === "en-au");
    utterance.voice =
      candidates.find((item) => item.localService) || candidates[0] || null;
    utterance.lang = "en-AU";
    utterance.rate = presentation.voice.rate;
    utterance.pitch = presentation.voice.pitch;
    utterance.volume = presentation.voice.volume;
    utterance.onstart = () => {
      if (speechRevision === revision) {
        setState(
          "speaking",
          "Speaking · labelled system fallback",
          presentation,
        );
      }
    };
    const finish = () => {
      if (speechRevision === revision) {
        setState("success", "Ready", presentation);
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      finish();
    }
  };

  const update = () => {
    const online = navigator.onLine !== false;
    send.disabled = busy || !online || !input.value.trim();
    input.disabled = busy;
    panel.setAttribute("aria-busy", busy ? "true" : "false");
  };
  const readJson = async (response, maximum = MAX_RESPONSE_BYTES) => {
    const contentType = response.headers.get("content-type")?.trim() || "";
    if (
      !/^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|$)/i.test(
        contentType,
      )
    ) {
      throw new Error("response_media_invalid");
    }
    const declared = response.headers.get("content-length")?.trim() || "";
    if (/^\d+$/.test(declared) && Number(declared) > maximum) {
      throw new Error("response_too_large");
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error("response_body_unavailable");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let raw = "";
    let bytes = 0;
    let chunks = 0;
    let completed = false;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks += 1;
        if (chunks > MAX_RESPONSE_CHUNKS) {
          throw new Error("response_chunks_invalid");
        }
        bytes += result.value.byteLength;
        if (bytes > maximum) throw new Error("response_too_large");
        raw += decoder.decode(result.value, { stream: true });
      }
      raw += decoder.decode();
      completed = true;
    } finally {
      if (!completed) {
        try {
          await reader.cancel("response_rejected");
        } catch {}
      }
      try {
        reader.releaseLock();
      } catch {}
    }
    if (!raw.trim()) throw new Error("response_empty");
    return JSON.parse(raw);
  };

  const sendMessage = async () => {
    const content = input.value.trim();
    if (!content || busy || navigator.onLine === false) return;
    add("user", content);
    input.value = "";
    busy = true;
    update();
    setState("thinking", "Thinking");
    setMeta("Preparing a response…");
    controller?.abort("superseded");
    const active = new AbortController();
    controller = active;
    const timer = setTimeout(() => active.abort("timeout"), 20_000);
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ botId, messages: messages.slice(-20) }),
        signal: active.signal,
      });
      const data = await readJson(response);
      const reply =
        typeof data.message === "string"
          ? data.message
          : typeof data.reply === "string"
            ? data.reply
            : "";
      if (!response.ok || data.ok === false || !reply.trim()) {
        throw new Error("chat_failed");
      }
      add("assistant", reply);
      const result = await parsePresentation(data.presentation, reply);
      setMeta(
        result.verified
          ? result.presentation.voice.delivery === "approved-audio"
            ? "Verified animated EVA presentation · approved audio remains behind an authenticated Storage resolver."
            : "Verified animated EVA presentation · system voice fallback is labelled and opt-in."
          : "Animated local EVA presentation · server presentation was unavailable or failed verification; no remote audio or storage claim was trusted.",
      );
      speak(result.presentation);
    } catch {
      setState("error", "Response unavailable");
      setMeta(
        active.signal.aborted
          ? "The response took too long. Try again."
          : "EVA could not respond. Try again shortly.",
        true,
      );
    } finally {
      clearTimeout(timer);
      if (controller === active) controller = null;
      busy = false;
      update();
      input.focus();
    }
  };

  const setOpen = (open) => {
    panel.hidden = !open;
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    launcher.setAttribute("aria-label", `${open ? "Close" : "Open"} ${title}`);
    if (open) {
      input.focus();
      log.scrollTop = log.scrollHeight;
    } else {
      launcher.focus();
    }
  };
  const focusable = () =>
    [voice, close, input, send].filter(
      (element) => !element.disabled && !element.hidden,
    );

  launcher.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => {
    stopVoice(false);
    setOpen(false);
  });
  voice.addEventListener("click", () => {
    enabledVoice = !enabledVoice;
    voice.setAttribute("aria-pressed", enabledVoice ? "true" : "false");
    if (!enabledVoice) stopVoice();
    setMeta(
      enabledVoice
        ? "Voice enabled. System fallback remains clearly labelled."
        : "Voice disabled. Text remains primary.",
    );
  });
  send.addEventListener("click", () => void sendMessage());
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    } else if (event.key === "Escape") {
      stopVoice();
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      stopVoice(false);
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener("online", () => {
    if (meta.textContent === "You are offline.") setMeta("");
    update();
  });
  window.addEventListener("offline", () => {
    setMeta("You are offline.", true);
    update();
  });
  window.addEventListener(
    "pagehide",
    () => {
      controller?.abort("pagehide");
      stopVoice(false);
    },
    { once: true },
  );

  add("assistant", greeting);
  update();
})();
