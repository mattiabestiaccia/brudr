// dati.js: what the revisioni mod reads and sends, without drawing anything.
// No herdr or gpui import here, so the tests load it with plain node.
//
// The content of a review is pagina.json, the same JSON pr-revisione-ai gives
// Bruvish for pagina.html (contract «Contratto dei dati per Bruvish» in the
// README of tools/pr-revisione). Header, tree and state are brudr's own; the
// review brings only the content. Operations and notes go to the executor's
// private socket through pr-revisione-clic, never through the agent.

/** States of the PR as Bruvish names them (header.state), with the theme color of each. */
export const STATI = {
  bozza: { testo: "Bozza", colore: "muted" },
  aperta: { testo: "Aperta", colore: "ansi2" },
  unita: { testo: "Unita", colore: "ansi5" },
  chiusa: { testo: "Chiusa", colore: "ansi1" },
};

/** Bruvish tones (cards, labels, pills, events, dots) as theme color names. */
export const TONI = {
  blu: "accent", verde: "ansi2", giallo: "ansi3", rosso: "ansi1", decidi: "ansi3", viola: "ansi5", vuoto: "dim",
};
export const coloreTono = (tono) => TONI[tono] ?? "dim";

/** Icons of the header operations: the closed set of Bruvish (OPERATION_ICONS), plus the menu's. */
export const ICONE = ["unisci", "pronta", "revisore", "chiudi", "altre"];

/** Outcomes the executor gives an operation (pr-revisione-clic, README «Socket dell'esecutore»). */
export const ESITI_BUONI = ["fatto", "parziale", "rimandato"];

/** Images a note may carry, as the executor accepts them. */
export const IMMAGINE = /\.(png|jpe?g|webp)$/i;
export const MAX_IMMAGINI = 10;

/** The executor's answer waits at most this long (pr-revisione-clic --attesa, seconds). */
export const ATTESA_S = 300;

// ---- the list

/** Open PRs first (draft or open), then merged and closed, each part newest page first as elenco gives it. */
export function ordinaElenco(revisioni) {
  const aperta = (r) => r.stato === "aperta" || r.stato === "bozza";
  const lista = Array.isArray(revisioni) ? revisioni : [];
  return [...lista.filter(aperta), ...lista.filter((r) => !aperta(r))];
}

/** `pr-revisione-ai elenco --json` output, or { errore }. */
export function leggiElenco(r) {
  if (!r || r.code !== 0) return { errore: testoErrore(r, "pr-revisione-ai elenco non ha risposto") };
  try {
    const d = JSON.parse(r.stdout);
    if (!d || !Array.isArray(d.revisioni)) return { errore: "pr-revisione-ai elenco: risposta senza revisioni" };
    return { revisioni: ordinaElenco(d.revisioni), mostrate: d.mostrate, totale: d.totale };
  } catch {
    return { errore: "pr-revisione-ai elenco: risposta non leggibile" };
  }
}

export function testoErrore(r, prima) {
  const t = String(r?.stderr || r?.stdout || r?.message || r || "").trim();
  return (t || prima).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 400);
}

// ---- the page

/** pagina.json text to the page, or { errore }. Only the parts the panel draws are checked. */
export function leggiPagina(testo) {
  if (typeof testo !== "string") return { errore: "pagina.json non c'è (la pagina non è ancora stata generata)" };
  let d;
  try {
    d = JSON.parse(testo);
  } catch {
    return { errore: "pagina.json non è leggibile" };
  }
  if (!d || typeof d !== "object" || !Array.isArray(d.sections)) return { errore: "pagina.json senza sezioni" };
  return { pagina: d };
}

/**
 * The tree of the sidebar: sections in their order; a section with `group` goes under that
 * group, which takes the place of its first section. Each entry: { id, titolo, dot, count }
 * and, for a group, `figli`.
 */
export function albero(pagina) {
  const gruppi = new Map((pagina?.groups ?? []).map((g) => [g.id, g]));
  const out = [], visti = new Map();
  for (const s of pagina?.sections ?? []) {
    const voce = { id: s.id, titolo: s.title ?? s.id, dot: s.dot ?? null, count: s.count ?? null };
    if (!s.group) {
      out.push(voce);
      continue;
    }
    let g = visti.get(s.group);
    if (!g) {
      const def = gruppi.get(s.group) ?? { id: s.group, title: s.group };
      g = { id: `gruppo-${def.id}`, gruppo: def.id, titolo: def.title ?? def.id, dot: def.dot ?? null, count: def.count ?? null, figli: [] };
      visti.set(s.group, g);
      out.push(g);
    }
    g.figli.push(voce);
  }
  return out;
}

/** The section to show first: the requested one if it is still there, else the first. */
export function sezioneScelta(pagina, voluta) {
  const ss = pagina?.sections ?? [];
  return ss.find((s) => s.id === voluta) ?? ss[0] ?? null;
}

/** The title path of a card, as notes name it: «Sintesi › Rischi». */
export const elementoCarta = (sezione, carta) => `${sezione?.title ?? sezione?.id ?? ""} › ${carta?.title ?? carta?.id ?? ""}`;

// Bruvish inline marks to Markdown: **bold** and `code` stay, ==highlight== becomes bold.
export const inline = (t) => String(t ?? "").replace(/==([^=\n][^\n]*?)==/g, "**$1**");

/** A Bruvish text block (string, or paragraphs, each a string or sentences) as Markdown paragraphs. */
export function paragrafi(valore) {
  if (valore === undefined || valore === null) return [];
  const blocco = Array.isArray(valore) ? valore : [valore];
  return blocco.map((p) => (Array.isArray(p) ? p : [p]).map((f) => {
    const o = f !== null && typeof f === "object";
    const testo = inline(o ? f.text : f);
    return o && f.highlight ? `**${testo}**` : testo;
  }).join(" ")).filter((p) => p.trim());
}

/** A table cell: { testo, tono }. */
export const cella = (c) => (typeof c === "string" ? { testo: inline(c), tono: null } : { testo: inline(c?.text ?? ""), tono: c?.tone ?? null });

/** The header's title without the PR number, which the facts table carries (header D, as Bruvish). */
export const titoloSenzaNumero = (t) => piano(String(t ?? "").replace(/ #\d+$/, ""));

/** Plain text of marks, for one-line places (titles, buttons). */
export const piano = (t) => String(t ?? "").replace(/\*\*|==|`/g, "");

/**
 * The header's operations: { view, principali, fisse, accanto, menu }, as Bruvish's
 * iconActions lays them out: menu items with an icon stand beside the menu.
 */
export function operazioni(pagina) {
  const a = pagina?.actions ?? {};
  const menu = Array.isArray(a.menu) ? a.menu : [];
  return {
    view: typeof a.view === "string" ? a.view : null,
    principali: Array.isArray(a.primary) ? a.primary : [],
    fisse: Array.isArray(a.fixed) ? a.fixed : [],
    accanto: menu.filter((o) => o.icon),
    menu: menu.filter((o) => !o.icon),
  };
}

/** Operations the view offers (diagnostics.view.offerte), for the diff's line comment. */
export const offerte = (pagina) => pagina?.diagnostics?.view?.offerte ?? [];

/** The state after an operation the executor answered, or the state before. */
export function statoDopo(operazione, esito, prima) {
  if (esito === "fatto") {
    const dopo = { unisci: "unita", "pronta-unisci": "unita", chiudi: "chiusa", riapri: "aperta", pronta: "aperta",
      bozza: "bozza", correzione: "bozza", "approva-pronta": "aperta" }[operazione];
    return dopo ?? prima;
  }
  // «Pronta e unisci» a metà: out of draft, not merged (README «Ripieghi»).
  if (esito === "parziale" && operazione === "pronta-unisci") return "aperta";
  return prima;
}

// ---- what goes to the executor

/**
 * Arguments of pr-revisione-clic for a request:
 * { tipo: "operazione", nome, operazione, vista, testo?, file?, riga? } or
 * { tipo: "nota", nome, testo?, elemento?, file?, riga?, immagini? }.
 */
export function argomentiClic(q) {
  const a = [q.tipo, q.nome];
  if (q.tipo === "operazione") {
    a.push(q.operazione, "--vista", q.vista);
    if (q.testo) a.push("--testo", q.testo);
  } else if (q.tipo === "nota") {
    if (q.testo) a.push("--testo", q.testo);
    if (q.elemento) a.push("--elemento", q.elemento);
    for (const p of q.immagini ?? []) a.push("--immagine", p);
  } else {
    throw new Error(`tipo sconosciuto: ${q.tipo}`);
  }
  if (q.file) a.push("--file", q.file, "--riga", String(q.riga));
  a.push("--json", "--attesa", String(ATTESA_S));
  return a;
}

/**
 * pr-revisione-clic's result: { ok, tipo, esito, testo, immagini, immagini_perse } or
 * { ok: false, errore, rimedio }. Without a JSON answer (socket missing or refused,
 * timeout) the client says why on stderr.
 */
export function leggiRisposta(r) {
  const riga = String(r?.stdout ?? "").trim().split("\n").filter(Boolean).pop();
  if (riga) {
    try {
      const d = JSON.parse(riga);
      if (d && typeof d === "object") return d;
    } catch { /* falls through */ }
  }
  return { ok: false, errore: testoErrore(r, "pr-revisione-clic non ha risposto") };
}

/** One line for an answer, and its tone. */
export function rigaEsito(d) {
  if (!d?.ok) return { testo: [d?.errore, d?.rimedio].filter(Boolean).join(" · ") || "richiesta respinta", tono: "rosso" };
  if (d.tipo === "nota") {
    const perse = d.immagini_perse?.length ? ` · immagini non arrivate: ${d.immagini_perse.length}` : "";
    return { testo: (d.testo || "Nota in coda per l'agente.") + perse, tono: perse ? "giallo" : "verde" };
  }
  const e = d.esito ?? {};
  const tono = e.esito === "fatto" ? "verde" : ESITI_BUONI.includes(e.esito) ? "giallo" : "rosso";
  return { testo: piano(d.testo || [e.esito, e.motivo].filter(Boolean).join(": ")), tono };
}

// ---- the diff

const STATI_DIFF = { added: "nuovo", deleted: "cancellato", renamed: "rinominato", modified: "modificato" };
export const statoFile = (s) => STATI_DIFF[s] ?? s;

function utf8(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    const n = b < 0x80 ? 1 : b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    let c = n === 1 ? b : b & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) c = (c << 6) | (bytes[i + k] & 0x3f);
    s += String.fromCodePoint(c);
    i += n;
  }
  return s;
}

function togliVirgolette(nome) {
  if (!nome.startsWith('"') || !nome.endsWith('"')) return nome;
  const fughe = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  const t = nome.slice(1, -1), bytes = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && i + 1 < t.length) {
      const m = /^[0-7]{1,3}/.exec(t.slice(i + 1));
      if (m) { bytes.push(parseInt(m[0], 8)); i += m[0].length; continue; }
      if (t[i + 1] in fughe) { bytes.push(fughe[t[i + 1]]); i++; continue; }
    }
    for (const b of new TextEncoderLite(t[i]).bytes) bytes.push(b);
  }
  return utf8(bytes);
}

// UTF-8 bytes of one character (TextEncoder may be missing in the mod's runtime).
class TextEncoderLite {
  constructor(ch) {
    const c = ch.codePointAt(0);
    this.bytes = c < 0x80 ? [c] : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 63)]
      : c < 0x10000 ? [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)]
      : [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
  }
}

/**
 * A unified diff, file by file, as Bruvish's parseDiff reads it: { name, status, added,
 * removed, lines: [{ type: hunk|meta|add|del|context, old, new, text }] }. Line numbers of
 * the new side are the ones a line comment and a note name.
 */
export function parseDiff(text) {
  const files = [];
  let file = null, previous = null, oldLine = 0, newLine = 0, oldLeft = 0, newLeft = 0, gitHeader = false;
  const start = (name) => { file = { name, status: "modified", added: 0, removed: 0, lines: [] }; files.push(file); };
  for (const line of String(text ?? "").split("\n")) {
    if (file && (oldLeft > 0 || newLeft > 0)) {
      const sign = line[0], body = line.slice(1);
      if (sign === "+") { file.lines.push({ type: "add", old: null, new: newLine++, text: body }); file.added++; newLeft--; continue; }
      if (sign === "-") { file.lines.push({ type: "del", old: oldLine++, new: null, text: body }); file.removed++; oldLeft--; continue; }
      if (sign === " " || line === "") { file.lines.push({ type: "context", old: oldLine++, new: newLine++, text: body }); oldLeft--; newLeft--; continue; }
      if (sign !== "\\") oldLeft = newLeft = 0;
    }
    if (line.startsWith("\\")) { file?.lines.push({ type: "meta", old: null, new: null, text: line }); continue; }
    if (line.startsWith("diff --git ")) {
      const git = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*")$/.exec(line) || /^diff --git a\/(.+) (b\/\1)$/.exec(line);
      start(git ? togliVirgolette(git[2]).replace(/^b\//, "") : "");
      previous = null;
      gitHeader = true;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const name = togliVirgolette(line.slice(4).replace(/\t.*$/, "")), none = name === "/dev/null";
      if (line[0] === "-") { previous = none ? null : name.replace(/^a\//, ""); continue; }
      if (!gitHeader || !file || file.lines.length) start(none ? previous : name.replace(/^b\//, ""));
      else file.name = none ? previous : name.replace(/^b\//, "");
      if (previous === null) file.status = "added";
      else if (none) file.status = "deleted";
      gitHeader = false;
      continue;
    }
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk && file) {
      [oldLine, oldLeft, newLine, newLeft] = [Number(hunk[1]), hunk[2] === undefined ? 1 : Number(hunk[2]), Number(hunk[3]), hunk[4] === undefined ? 1 : Number(hunk[4])];
      file.lines.push({ type: "hunk", old: null, new: null, text: line });
      gitHeader = false;
      continue;
    }
    if (file && /^new file mode/.test(line)) file.status = "added";
    else if (file && /^deleted file mode/.test(line)) file.status = "deleted";
    else if (file && /^rename from /.test(line)) file.status = "renamed";
    else if (file && /^(?:rename|copy) to /.test(line)) file.name = togliVirgolette(line.replace(/^(?:rename|copy) to /, ""));
  }
  return files;
}

// Text draws a tab as nothing: pad each to the next 4-column stop (as Herdr's changes mod).
export const senzaTab = (t) => String(t).replace(/[^\t]*\t/g, (s) => s.slice(0, -1).padEnd((s.length - 1) - (s.length - 1) % 4 + 4));

// ---- V1: the same review in a web block, on its Lavish session

/** Lavish's port as the executor picks it: DEFAULT_PORT of Bruvish's env.mjs, else 4388. */
export function portaLavish(envMjs) {
  const m = /export\s+const\s+DEFAULT_PORT\s*=\s*["'](\d{2,5})["']/.exec(String(envMjs ?? ""));
  return m ? m[1] : "4388";
}

/** The Lavish session URL of a review: key = sha256(<cartella>/pagina.html)[:16] (pr-revisione-esecutore, Lavish.rispondi). */
export const urlLavish = (cartella, porta) => `http://127.0.0.1:${porta}/session/${sha256(`${String(cartella).replace(/\/+$/, "")}/pagina.html`).slice(0, 16)}`;

/** The layout file's text with the web block `id` showing `url`; { testo } or { errore }. */
export function conUrl(testo, id, url) {
  let d;
  try {
    d = JSON.parse(testo);
  } catch {
    return { errore: "layout file not readable" };
  }
  const n = trova(d, id);
  if (!n || !n.content || typeof n.content.web !== "object") return { errore: `no web block "${id}" in the layout file` };
  if (n.content.web.url === url) return { testo, uguale: true };
  n.content.web.url = url;
  return { testo: JSON.stringify(d, null, 2) + "\n" };
}

export function trova(n, id) {
  if (!n || typeof n !== "object") return null;
  if (n.id === id) return n;
  for (const c of n.children ?? []) {
    const f = trova(c, id);
    if (f) return f;
  }
  return null;
}

/** SHA-256 of a string's UTF-8 bytes, as hex. */
export function sha256(testo) {
  const bytes = [];
  for (const ch of String(testo)) bytes.push(...new TextEncoderLite(ch).bytes);
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70,
    0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  const r = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Array(64);
  for (let o = 0; o < bytes.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    H.splice(0, 8, ...H.map((x, i) => (x + [a, b, c, d, e, f, g, h][i]) | 0));
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
