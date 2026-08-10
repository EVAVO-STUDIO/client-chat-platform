// SUPER EVA standalone chat widget for client-chat-platform.
// Loads independently from the legacy widget and uses the existing /api/chat contract.
(() => {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  const bounded = (value, fallback, maximum) =>
    (String(value || "").trim() || fallback).slice(0, maximum);
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
  const safeAudioUrl = (value) => {
    if (!value) return null;
    try {
      const url = new URL(String(value));
      if (url.protocol !== "https:" || url.username || url.password || url.hash) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
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
  const position = script.getAttribute("data-position") === "left" ? "left" : "right";
  const accent = /^#[a-f0-9]{6}$/i.test(script.getAttribute("data-accent") || "")
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
    .launcher-avatar{width:38px;height:38px}.launcher-label{font-size:12px;font-weight:900;letter-spacing:.06em}.avatar{width:108px;height:108px;flex:0 0 auto}
    .face{position:relative;width:56%;height:50%;border-radius:46% 46% 50% 50%;background:linear-gradient(165deg,#ffd6cc,#be716b);box-shadow:inset 0 -8px 18px rgba(83,25,28,.28)}
    .eye{position:absolute;top:35%;width:8px;height:6px;border-radius:50%;background:#241116;transition:transform .16s ease}.eye.left{left:25%}.eye.right{right:25%}
    .mouth{position:absolute;left:50%;bottom:20%;width:20px;height:4px;transform:translateX(-50%);border-radius:0 0 18px 18px;border-bottom:3px solid #6c2630;transition:height .12s ease,border-radius .12s ease}
    .state-speaking .mouth{height:13px;border:3px solid #6c2630;background:#2d0b10;animation:eva-mouth .32s ease-in-out infinite alternate}.state-listening .eye{transform:scaleY(1.35)}.state-thinking .avatar{animation:eva-think 2.4s ease-in-out infinite}.state-error .avatar{box-shadow:inset 0 0 24px rgba(255,255,255,.12),0 0 0 3px #ff6d86}.state-success .mouth{height:9px;border-radius:0 0 18px 18px}
    .panel{position:fixed;z-index:2147483000;bottom:82px;${position}:18px;width:min(430px,calc(100vw - 24px));height:min(690px,calc(100dvh - 106px));display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,#111620,#080a0f);color:var(--text);box-shadow:0 32px 100px rgba(0,0,0,.62)}.panel[hidden]{display:none}
    .head{display:flex;align-items:center;gap:14px;padding:18px;border-bottom:1px solid var(--line);background:radial-gradient(circle at 18% 0,color-mix(in srgb,var(--eva) 18%,transparent),transparent 48%)}
    .identity{min-width:0;flex:1}.eyebrow{margin:0 0 5px;color:var(--eva);font-size:9px;font-weight:950;letter-spacing:.18em;text-transform:uppercase}.title{margin:0;font-size:17px;font-weight:950}.state{margin:5px 0 0;color:var(--muted);font-size:11px}.close,.send,.voice{border:1px solid var(--line);border-radius:12px;background:#171d28;color:var(--text);cursor:pointer}.close{width:40px;height:40px;font-size:20px}.voice{min-height:34px;padding:7px 10px;font-size:10px;font-weight:900;text-transform:uppercase}.voice[aria-pressed="true"]{border-color:var(--eva);color:#fff}
    .log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;display:flex;flex-direction:column;gap:11px}.row{display:flex}.row.user{justify-content:flex-end}.bubble{max-width:86%;border:1px solid var(--line);border-radius:16px;padding:11px 13px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.5}.user .bubble{background:var(--eva);border-color:var(--eva);color:var(--ink);border-bottom-right-radius:5px}.assistant .bubble{background:var(--card);border-bottom-left-radius:5px}
    .meta{min-height:31px;padding:6px 16px 11px;color:var(--muted);font-size:10px;line-height:1.45}.meta.error{color:#ff9aac}.composer{border-top:1px solid var(--line);padding:12px;background:#10141d}.input-row{display:flex;align-items:flex-end;gap:8px}.input{flex:1;min-height:44px;max-height:130px;resize:none;border:1px solid var(--line);border-radius:13px;background:#090c12;color:var(--text);padding:11px;outline:none}.send{width:46px;height:46px;border:0;background:var(--eva);color:var(--ink);font-size:18px;font-weight:950}.send:disabled{opacity:.45;cursor:not-allowed}.privacy{margin:7px 2px 0;color:#6f7988;font-size:9px}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @keyframes eva-mouth{from{height:5px}to{height:15px}}@keyframes eva-think{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-3px) scale(1.025)}}
    @media(max-width:520px){.launcher{bottom:12px;${position}:12px}.panel{bottom:72px;${position}:12px;width:calc(100vw - 24px);height:min(720px,calc(100dvh - 90px))}}
    @media(prefers-reduced-motion:reduce){.state-speaking .mouth,.state-thinking .avatar{animation:none}}
  `;

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-expanded", "false");
  const launcherAvatar = document.createElement("span");
  launcherAvatar.className = "launcher-avatar";
  const launcherLabel = document.createElement("span");
  launcherLabel.className = "launcher-label";
  launcherLabel.textContent = "Ask EVA";
  launcher.append(launcherAvatar, launcherLabel);

  const panel = document.createElement("section");
  panel.className = "panel state-ready";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");

  const head = document.createElement("header");
  head.className = "head";
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
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
  heading.textContent = title;
  const stateLabel = document.createElement("p");
  stateLabel.className = "state";
  stateLabel.textContent = "Ready";
  identity.append(eyebrow, heading, stateLabel);
  const voice = document.createElement("button");
  voice.className = "voice";
  voice.type = "button";
  voice.textContent = "Voice";
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
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.setAttribute("role", "status");
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
  input.maxLength = 2000;
  input.placeholder = "Ask EVA…";
  label.htmlFor = `eva-input-${botId}`;
  input.id = label.htmlFor;
  const send = document.createElement("button");
  send.className = "send";
  send.type = "button";
  send.textContent = "↑";
  send.setAttribute("aria-label", "Send message");
  const privacy = document.createElement("p");
  privacy.className = "privacy";
  privacy.textContent = "Text is primary. Voice is optional. Never share passwords or credentials.";
  row.append(label, input, send);
  composer.append(row, privacy);
  panel.append(head, log, meta, composer);
  shadow.append(style, launcher, panel);
  document.body.appendChild(host);

  const messages = [];
  let busy = false;
  let enabledVoice = voiceEnabled;
  let controller = null;
  let audio = null;

  const setState = (state, detail) => {
    for (const value of ["ready", "listening", "thinking", "speaking", "working", "success", "error", "stopped"]) {
      panel.classList.toggle(`state-${value}`, value === state);
    }
    stateLabel.textContent = detail || state.charAt(0).toUpperCase() + state.slice(1);
  };
  const setMeta = (text, error = false) => {
    meta.textContent = text || "";
    meta.classList.toggle("error", error);
  };
  const add = (role, text) => {
    const content = String(text || "").trim().slice(0, role === "user" ? 2000 : 8000);
    if (!content) return;
    const messageRow = document.createElement("div");
    messageRow.className = `row ${role === "user" ? "user" : "assistant"}`;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;
    messageRow.append(bubble);
    log.append(messageRow);
    messages.push({ role: role === "user" ? "user" : "assistant", content });
    if (messages.length > 20) messages.splice(0, messages.length - 20);
    log.scrollTop = log.scrollHeight;
  };
  const stopVoice = () => {
    if (audio) {
      audio.pause();
      audio.src = "";
      audio = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("stopped", "Stopped");
  };
  const localPresentation = (text) => ({
    contractVersion: "eva_super_presentation_v1",
    presentationId: `local_${Date.now()}`,
    text,
    spokenText: text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 20).join(" "),
    avatar: {
      characterId: "eva-female",
      manifestRef: "evavo-avatar://eva-female/v1",
      state: "speaking",
      gesture: "explain",
      emotion: "warm",
      animationProfile: "natural",
    },
    voice: {
      profileId: "eva-original",
      language: "en-AU",
      delivery: "system-fallback",
      outputMode: "quiet",
      rate: 0.92,
      pitch: 1.01,
      volume: 0.44,
      audioRef: null,
    },
    storage: {
      reference: "evavo-storage://super-eva/not-requested",
      retention: "ephemeral",
      status: "not-requested",
    },
  });
  const parsePresentation = (value, fallbackText) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return localPresentation(fallbackText);
    const avatarValue = value.avatar;
    const voiceValue = value.voice;
    if (
      value.contractVersion !== "eva_super_presentation_v1" ||
      typeof value.spokenText !== "string" ||
      !avatarValue ||
      avatarValue.characterId !== "eva-female" ||
      avatarValue.manifestRef !== "evavo-avatar://eva-female/v1" ||
      !voiceValue ||
      voiceValue.profileId !== "eva-original" ||
      voiceValue.language !== "en-AU" ||
      !["approved-audio", "system-fallback", "silent"].includes(voiceValue.delivery)
    ) {
      return localPresentation(fallbackText);
    }
    return value;
  };
  const speak = (presentation) => {
    if (!enabledVoice || presentation.voice.delivery === "silent" || !presentation.spokenText) {
      setState("success", "Ready");
      return;
    }
    stopVoice();
    const approved =
      presentation.voice.delivery === "approved-audio"
        ? safeAudioUrl(presentation.voice.audioRef)
        : null;
    if (approved) {
      audio = new Audio(approved);
      audio.onplay = () => setState("speaking", "Speaking · approved EVA audio");
      audio.onended = () => {
        audio = null;
        setState("success", "Ready");
      };
      audio.onerror = () => {
        audio = null;
        setMeta("Approved audio could not be played. The response remains on screen.", true);
        setState("error", "Audio unavailable");
      };
      void audio.play().catch(() => setMeta("Use Voice to allow audio playback.", true));
      return;
    }
    if (!("speechSynthesis" in window)) {
      setState("success", "Ready · voice unavailable");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(presentation.spokenText);
    const candidates = window.speechSynthesis.getVoices().filter((item) => item.lang.toLowerCase() === "en-au");
    utterance.voice = candidates.find((item) => item.localService) || candidates[0] || null;
    utterance.lang = "en-AU";
    utterance.rate = Number(presentation.voice.rate) || 0.92;
    utterance.pitch = Number(presentation.voice.pitch) || 1.01;
    utterance.volume = Number(presentation.voice.volume) || 0.44;
    utterance.onstart = () => setState("speaking", "Speaking · labelled system fallback");
    utterance.onend = () => setState("success", "Ready");
    utterance.onerror = () => setState("success", "Ready");
    window.speechSynthesis.speak(utterance);
  };
  const update = () => {
    send.disabled = busy || navigator.onLine === false || !input.value.trim();
    input.disabled = busy;
    panel.setAttribute("aria-busy", busy ? "true" : "false");
  };
  const readJson = async (response, maximum = 65536) => {
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > maximum) throw new Error("response_too_large");
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
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), 20000);
    try {
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ botId, messages: messages.slice(-20) }),
        signal: controller.signal,
      });
      const data = await readJson(response);
      const reply = typeof data.message === "string" ? data.message : typeof data.reply === "string" ? data.reply : "";
      if (!response.ok || data.ok === false || !reply.trim()) throw new Error("chat_failed");
      add("assistant", reply);
      const presentation = parsePresentation(data.presentation, reply);
      setMeta(
        presentation.voice.delivery === "approved-audio"
          ? "Approved EVA audio and avatar presentation."
          : "Animated EVA presentation · system voice fallback is labelled and opt-in.",
      );
      speak(presentation);
    } catch (error) {
      setState("error", "Response unavailable");
      setMeta(controller.signal.aborted ? "The response took too long. Try again." : "EVA could not respond. Try again shortly.", true);
    } finally {
      clearTimeout(timer);
      controller = null;
      busy = false;
      update();
      input.focus();
    }
  };

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    if (!panel.hidden) input.focus();
  });
  close.addEventListener("click", () => {
    stopVoice();
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  });
  voice.addEventListener("click", () => {
    enabledVoice = !enabledVoice;
    voice.setAttribute("aria-pressed", enabledVoice ? "true" : "false");
    if (!enabledVoice) stopVoice();
    setMeta(enabledVoice ? "Voice enabled. System fallback remains clearly labelled." : "Voice disabled. Text remains primary.");
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
  window.addEventListener("pagehide", () => {
    controller?.abort("pagehide");
    stopVoice();
  }, { once: true });

  add("assistant", greeting);
  update();
})();
