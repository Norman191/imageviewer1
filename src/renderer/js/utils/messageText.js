// Renders message text into `container` as a sequence of real DOM nodes:
// plain text, safe formatting tags (<b>/<i>/<u>/<s>/<strong>/<em>),
// highlighted mentions (@everyone / @Character), and clickable URLs.
// Deliberately builds nodes directly (textContent / createElement) rather
// than ever setting innerHTML on a live element, so nothing in a message's
// text can be interpreted as markup we didn't explicitly allow.
//
// Mentions are only recognized when they match an entry in `message.mentions`
// (populated by the composer's @ picker at send time) — this avoids
// blindly treating every "@word" typed by hand as a mention.

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

// Only these tags survive; everything else is either dropped (script/style,
// content included) or "unwrapped" (the tag is discarded but its text
// content is kept, e.g. a stray <div> just becomes plain text).
const ALLOWED_TAGS = new Set([
  'B', 'I', 'U', 'S', 'STRONG', 'EM', 'DEL', 'MARK', 'SMALL', 'BIG', 'SUP', 'SUB', 'BR', 'CODE', 'BLOCKQUOTE', 'PRE'
]);
const DROP_ENTIRELY_TAGS = new Set(['SCRIPT', 'STYLE']);

// Parses `rawText` via an inert <template> (its content never executes or
// attaches to the live page, per the HTML spec — this is a standard safe
// way to turn a string into a DOM tree without risking script execution),
// then rebuilds a brand-new tree keeping ONLY whitelisted tags and NEVER
// copying any attributes (so onclick/style/src/href etc. on a tag like
// `<b onmouseover="...">` are stripped even for otherwise-allowed tags).
function sanitizeToFragment(rawText) {
  const template = document.createElement('template');
  template.innerHTML = rawText;
  const output = document.createDocumentFragment();
  copySanitized(template.content, output);
  return output;
}

function copySanitized(sourceParent, targetParent) {
  sourceParent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(document.createTextNode(child.textContent));
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) return; // skip comments etc.
    const tag = child.tagName;
    if (DROP_ENTIRELY_TAGS.has(tag)) return; // drop tag AND its content
    if (ALLOWED_TAGS.has(tag)) {
      const clean = document.createElement(tag.toLowerCase());
      targetParent.appendChild(clean);
      copySanitized(child, clean); // never copies attributes
    } else {
      copySanitized(child, targetParent); // unwrap: keep children only
    }
  });
}

function appendMentionAndUrlText(container, text, mentionList) {
  if (!mentionList.length) {
    appendUrlTokenizedText(container, text);
    return;
  }

  const matches = [];
  mentionList.forEach((mention) => {
    let searchFrom = 0;
    while (searchFrom <= text.length) {
      const idx = text.indexOf(mention.raw, searchFrom);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + mention.raw.length, mention });
      searchFrom = idx + mention.raw.length;
    }
  });
  matches.sort((a, b) => a.start - b.start);

  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) continue; // overlapping match, skip
    if (m.start > cursor) appendUrlTokenizedText(container, text.slice(cursor, m.start));
    const span = document.createElement('span');
    span.className = m.mention.type === 'everyone' ? 'mention mention-everyone' : 'mention';
    span.textContent = m.mention.raw;
    span.addEventListener('click', (e) => e.stopPropagation());
    container.appendChild(span);
    cursor = m.end;
  }
  if (cursor < text.length) appendUrlTokenizedText(container, text.slice(cursor));
}

function appendUrlTokenizedText(container, text) {
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match;
  while ((match = URL_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const url = match[0];
    const link = document.createElement('a');
    link.className = 'message-link';
    link.href = url;
    link.textContent = url;
    link.title = url;
    link.addEventListener('click', (e) => e.stopPropagation());
    container.appendChild(link);
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) {
    container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

// Walks the sanitized (whitelist-only) tree: text nodes get the existing
// mention/URL treatment; allowed formatting tags become fresh elements
// (still no attributes) with their own children recursively processed the
// same way, so e.g. `<b>check @Alex or https://x.com</b>` still highlights
// the mention and link INSIDE the bold text.
function appendSanitizedTree(targetParent, sourceNode, mentionList) {
  sourceNode.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      appendMentionAndUrlText(targetParent, child.textContent, mentionList);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const clone = document.createElement(child.tagName.toLowerCase());
      targetParent.appendChild(clone);
      appendSanitizedTree(clone, child, mentionList);
    }
  });
}

export function renderMessageText(container, text, mentions) {
  const mentionList = Array.isArray(mentions) ? mentions.filter((m) => m && m.raw) : [];
  const fragment = sanitizeToFragment(text || '');
  appendSanitizedTree(container, fragment, mentionList);
}
