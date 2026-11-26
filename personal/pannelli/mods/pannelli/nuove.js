// nuove: which PR reviews are new, for the purple dot on the Revisioni button and in
// the panel's list. No herdr import here, so the tests load it with plain node.
//
// Decision of 26 November 2026: a review of a PR is no longer opened in Bruvish by
// the agent that prepares it; brudr shows a purple dot on «Revisioni» instead.
//
// New = a review of an open or draft PR, with a page, whose head the panel has not
// shown yet. The executor regenerates a page often (events, notes, an operation)
// without the head changing: that never relights the dot. `pr-revisione-ai elenco
// --json` has no head field, so the head is read from the page itself (pagina.json,
// the «Head» fact of the header), only for the reviews that could be new.
//
// The state «seen» is the mod's: { <review name>: { testa, visto } } in a file in
// brudr's home. Opening a review in the panel marks it seen with the page's head
// at that moment, and again when the executor rewrites the open page for a new head.

export const APERTE = ["aperta", "bozza"];
export const FACT_TESTA = "Head";
export const MAX_VISTE = 300;
export const NOME_VALIDO = /^[\w.-]{1,200}$/;

/** A review that can be new: open or draft PR with a page. */
export const candidata = (r) => Boolean(r && APERTE.includes(r.stato) && r.pagina_json && NOME_VALIDO.test(String(r.nome ?? "")));

/** The page's head (the text of the «Head» fact, without backticks), or null. */
export function testaDi(testoPagina) {
  if (typeof testoPagina !== "string") return null;
  let d;
  try {
    d = JSON.parse(testoPagina);
  } catch {
    return null;
  }
  const fatti = d?.header?.facts;
  if (!Array.isArray(fatti)) return null;
  const f = fatti.find((x) => x?.label === FACT_TESTA);
  const t = typeof f?.text === "string" ? f.text.replace(/`/g, "").trim() : "";
  return t || null;
}

/** The file's text to { name: { testa, visto } }, empty when absent or not readable. */
export function leggiViste(testo) {
  if (typeof testo !== "string") return {};
  try {
    const d = JSON.parse(testo);
    if (!d || typeof d !== "object" || Array.isArray(d)) return {};
    const out = {};
    for (const [nome, v] of Object.entries(d)) {
      if (!NOME_VALIDO.test(nome) || !v || typeof v !== "object") continue;
      out[nome] = { testa: typeof v.testa === "string" ? v.testa : null, visto: Number(v.visto) || 0 };
    }
    return out;
  } catch {
    return {};
  }
}

/** One review is new: never shown, or shown with another head. An unknown head never relights. */
export function eNuova(r, viste, testa) {
  if (!candidata(r)) return false;
  const v = viste[r.nome];
  if (!v) return true;
  return Boolean(testa) && Boolean(v.testa) && v.testa !== testa;
}

/**
 * The names of the new reviews, in the list's order. `teste`: { name: { generata, testa } },
 * the head read from the page when the executor last generated it.
 */
export function nuove(revisioni, viste, teste) {
  return (revisioni ?? []).filter((r) => eNuova(r, viste, teste[r.nome]?.testa ?? null)).map((r) => r.nome);
}

/** `viste` with the review marked seen at `testa`; the oldest go when there are too many. */
export function conVista(viste, nome, testa, ora) {
  const out = { ...viste, [nome]: { testa: testa ?? viste[nome]?.testa ?? null, visto: ora } };
  const nomi = Object.keys(out);
  if (nomi.length > MAX_VISTE) {
    nomi.sort((a, b) => out[a].visto - out[b].visto).slice(0, nomi.length - MAX_VISTE).forEach((n) => delete out[n]);
  }
  return out;
}

export const testoViste = (viste) => JSON.stringify(viste, null, 1) + "\n";
