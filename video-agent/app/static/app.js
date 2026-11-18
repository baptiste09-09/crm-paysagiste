"use strict";

// ------------------------------------------------------------ utilitaires
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " Go" : Math.round(b / 1e6) + " Mo");
const fmtDur = (s) => { s = Math.round(s); return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}` : `${s} s`; };
const fmtT = (t) => Number(t).toFixed(1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = $("#app");
const STATUS = { en_attente: "En attente", analyse: "Analyse…", pret: "Prêt", erreur: "Erreur", brouillon: "Brouillon", rendu: "Rendu", modifie: "Modifié" };

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {} };
  if (opts.body !== undefined) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(opts.body); }
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  return r.json();
}

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const modal = $("#modal"), modalBody = $("#modal-body");
function openModal(title, html) { $("#modal-title").textContent = title; modalBody.innerHTML = html; modal.hidden = false; }
function closeModal() { modal.hidden = true; modalBody.innerHTML = ""; }
$("#modal-close").onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

const S = { info: null, project: null, tab: "rushs", words: {}, drafts: {}, uploads: [], seenJobs: {}, lastReload: 0 };
const pidUrl = () => `/api/projects/${S.project.id}`;
const srcById = (id) => S.project.sources.find((s) => s.id === id);
const isVoice = (s) => (s.info ? s.info.has_video === false : s.label[0] === "V");
const proxyUrl = (sid) => `/files/${S.project.id}/src/${sid}/proxy/proxy.mp4`;
const frameUrl = (sid, t) => `/files/${S.project.id}/src/${sid}/frames/${String(Math.floor(Math.max(0, t)) + 1).padStart(6, "0")}.jpg`;

// ------------------------------------------------------------ statut + navigation
function renderStatus() {
  const i = S.info, chips = [];
  chips.push(i.ffmpeg ? `<span class="chip">FFmpeg${i.hw_encoder ? " · accéléré" : ""}</span>` : `<span class="chip bad">FFmpeg absent</span>`);
  chips.push(i.whisper ? `<span class="chip">${esc(i.whisper)}</span>` : `<span class="chip warn">Whisper absent</span>`);
  chips.push(i.api_key ? `<span class="chip">Claude</span>` : `<span class="chip bad">Clé Claude absente</span>`);
  chips.push(`<span class="chip ${i.free_gb < 20 ? "warn" : ""}">${i.free_gb} Go libres</span>`);
  $("#status").innerHTML = chips.join("");
}

function route() {
  const h = location.hash.replace(/^#\/?/, "").split("/");
  const go = h[0] === "p" && h[1] ? openProject(h[1], h[2] || "rushs") : showHome();
  go.catch((e) => { app.innerHTML = `<div class="error">${esc(e.message)}</div>`; });
}
window.addEventListener("hashchange", route);

async function showHome() {
  stopPreview();
  S.project = null;
  const projects = await api("/api/projects");
  app.innerHTML = `
    <div class="card stack">
      <h2>Nouveau projet</h2>
      <div class="row"><input id="pname" class="grow" placeholder="Ex. Jardin Dupont – Lyon 6e"><button class="primary" id="pcreate">Créer</button></div>
      <p class="muted">Un projet = un lot de rushs (un chantier, une semaine…). Les rushs ajoutés depuis le Mac restent à leur place : rien n'est copié.</p>
    </div>
    <h2>Projets</h2>
    ${projects.length ? projects.map((p) => `
      <a class="card row spread" style="text-decoration:none;color:inherit" href="#/p/${esc(p.id)}">
        <div><b>${esc(p.name)}</b><div class="muted">${p.sources} rushs · ${fmtSize(p.size)} · ${p.clips} clip(s)</div></div><span>›</span>
      </a>`).join("") : `<p class="muted">Aucun projet pour l'instant.</p>`}`;
  $("#pcreate").onclick = async () => {
    try {
      const p = await api("/api/projects", { method: "POST", body: { name: $("#pname").value } });
      location.hash = `#/p/${p.id}`;
    } catch (e) { toast(e.message); }
  };
}

async function openProject(pid, tab) {
  if (!S.project || S.project.id !== pid) { S.drafts = {}; S.words = {}; }
  S.tab = tab;
  S.project = await api(`/api/projects/${pid}`);
  if (tab === "clips") S.words = await api(`/api/projects/${pid}/transcripts`);
  renderProject();
}

async function reload() {
  S.project = await api(pidUrl());
  if (S.tab === "clips") S.words = await api(`${pidUrl()}/transcripts`);
  S.lastReload = Date.now();
  renderProject();
}

function renderProject() {
  stopPreview();
  const p = S.project;
  app.innerHTML = `
    <div class="row spread"><h2 class="grow">${esc(p.name)}</h2><button class="ghost danger mini" id="pdel">Supprimer le projet</button></div>
    <nav class="tabs">${[["rushs", "1. Rushs"], ["brief", "2. Brief"], ["clips", "3. Clips"]]
      .map(([k, l]) => `<a href="#/p/${esc(p.id)}/${k}" class="${k === S.tab ? "on" : ""}">${l}</a>`).join("")}</nav>
    <div id="tab"></div>`;
  $("#pdel").onclick = async () => {
    if (!confirm("Supprimer ce projet (proxys, exports, vidéos envoyées depuis le téléphone) ? Les rushs ajoutés depuis un dossier du Mac ne sont pas touchés.")) return;
    await api(pidUrl(), { method: "DELETE" });
    location.hash = "#/";
  };
  ({ rushs: renderRushs, brief: renderBrief, clips: renderClips }[S.tab] || renderRushs)();
}

// ------------------------------------------------------------ onglet Rushs
function shotCard(src, sh, pick) {
  const tag = pick ? "button" : "div";
  return `<${tag} class="shot ${pick ? "pick" : ""}" data-sid="${src.id}" data-shot="${esc(sh.id)}">
    ${sh.strip ? `<img loading="lazy" src="/files/${S.project.id}/src/${src.id}/strips/${esc(sh.strip)}" alt="">` : ""}
    <div class="meta"><b>${esc(sh.id)}</b> · ${fmtT(sh.start)}–${fmtT(sh.end)} s · q${sh.qualite ?? "?"} i${sh.interet ?? "?"}<br>
    ${esc(sh.description || "")}<br><span class="muted">${esc((sh.tags || []).join(", "))}</span></div>
  </${tag}>`;
}

function srcCard(s) {
  const first = s.shots && s.shots[0];
  const thumb = isVoice(s) ? `<div class="thumb voice">🎙</div>` : first && first.thumb ? `<img class="thumb" src="/files/${S.project.id}/src/${s.id}/frames/${esc(first.thumb)}" alt="">` : `<div class="thumb"></div>`;
  const i = s.info, voice = isVoice(s);
  const info = !i ? "" : voice ? ` · ${fmtDur(i.duration)} · 🎙 voix off`
    : ` · ${fmtDur(i.duration)} · ${i.width}×${i.height}${i.hdr ? " · HDR" : ""}`;
  return `<div class="card">
    <div class="src">${thumb}
      <div class="grow">
        <div class="row spread"><b>${esc(s.label)} · ${esc(s.name)}</b><span class="badge ${esc(s.status)}">${STATUS[s.status] || esc(s.status)}</span></div>
        <div class="muted">${fmtSize(s.size)}${info}${s.speech ? " · 🗣 parole" : ""}</div>
        ${s.error ? `<div class="error">${esc(s.error)}</div>` : ""}
        ${(s.warnings || []).map((w) => `<div class="warnbox">${esc(w)}</div>`).join("")}
        <div class="row" style="margin-top:6px">
          ${s.shots && s.shots.length ? `<button class="mini" data-shots="${s.id}">Voir les ${s.shots.length} plans</button>` : ""}
          <button class="mini ghost danger" data-delsrc="${s.id}">Retirer</button>
        </div>
      </div>
    </div>
    <div class="shots" id="shots-${s.id}" hidden></div>
  </div>`;
}

function renderRushs() {
  const p = S.project;
  const pending = p.sources.filter((s) => s.status !== "pret").length;
  const total = p.sources.reduce((a, s) => a + (s.size || 0), 0);
  $("#tab").innerHTML = `
    <div class="card stack">
      <div class="row">
        <button id="addfolder">📁 Dossier du Mac</button>
        <label class="btn">📱 Envoyer vidéos / voix off<input type="file" id="upl" accept="video/*,audio/*" multiple hidden></label>
        <button class="primary" id="analyze" ${pending ? "" : "disabled"}>Analyser${pending ? ` (${pending})` : ""}</button>
      </div>
      <p class="muted">${p.sources.length} rushs · ${fmtSize(total)}. L'analyse lit chaque fichier une seule fois (proxy, son, images), puis transcrit la parole sur le Mac et fait décrire les plans par Claude (seules des vignettes partent sur Internet).
        Voix off : ajoute aussi tes enregistrements du dictaphone (.m4a, .mp3…), l'agent pose les images dessus.</p>
    </div>
    <div id="uploads" class="uploads"></div>
    ${p.sources.map(srcCard).join("")}`;
  renderUploads();
  $("#addfolder").onclick = () => browse("").catch((e) => toast(e.message));
  $("#upl").onchange = (e) => uploadFiles([...e.target.files], `${pidUrl()}/upload`, reload);
  $("#analyze").onclick = async () => {
    try { await api(`${pidUrl()}/analyze`, { method: "POST" }); toast("Analyse lancée"); pollJobs(true); } catch (e) { toast(e.message); }
  };
  $$("[data-shots]").forEach((b) => (b.onclick = () => {
    const s = srcById(b.dataset.shots), box = $(`#shots-${s.id}`);
    box.hidden = !box.hidden;
    if (!box.innerHTML) box.innerHTML = s.shots.map((sh) => shotCard(s, sh, false)).join("");
  }));
  $$("[data-delsrc]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Retirer ce rush du projet ?")) return;
    try { await api(`${pidUrl()}/sources/${b.dataset.delsrc}`, { method: "DELETE" }); await reload(); } catch (e) { toast(e.message); }
  }));
}

async function browse(path) {
  const d = await api(`/api/browse?path=${encodeURIComponent(path)}`);
  openModal("Choisir un dossier de rushs", `
    <div class="row">${d.shortcuts.map((s) => `<button class="mini" data-go="${esc(s.path)}">${esc(s.name)}</button>`).join("")}</div>
    <p class="small muted" style="overflow-wrap:anywhere">${esc(d.path)}</p>
    <div class="card row spread"><span>${d.videos} fichier(s) vidéo ou voix off ici${d.videos ? " · " + fmtSize(d.size) : ""}</span><button class="primary" id="pickdir">Ajouter ce dossier</button></div>
    <p class="muted small">Sous-dossiers inclus. Les fichiers restent où ils sont (disque externe possible, à garder branché jusqu'au rendu).</p>
    <div class="dirs">${d.parent ? `<button data-go="${esc(d.parent)}">⬆︎ Dossier parent</button>` : ""}
      ${d.dirs.map((x) => `<button data-go="${esc(x.path)}">📁 ${esc(x.name)}</button>`).join("")}</div>`);
  $$("[data-go]", modalBody).forEach((b) => (b.onclick = () => browse(b.dataset.go).catch((e) => toast(e.message))));
  $("#pickdir").onclick = async () => {
    try {
      const r = await api(`${pidUrl()}/sources`, { method: "POST", body: { paths: [d.path] } });
      closeModal(); toast(`${r.added} rush(s) ajouté(s) sur ${r.found} trouvé(s)`); await reload();
    } catch (e) { toast(e.message); }
  };
}

// ------------------------------------------------------------ envoi de gros fichiers (reprise auto)
const CHUNK = 32 * 1024 * 1024;

async function putChunk(endpoint, file, offset, blob) {
  const url = `${endpoint}?name=${encodeURIComponent(file.name)}&offset=${offset}&size=${file.size}`;
  const r = await fetch(url, { method: "PUT", body: blob });
  if (r.status === 409) return r.json(); // le serveur indique où reprendre
  if (!r.ok) { let m = r.statusText; try { m = (await r.json()).detail || m; } catch { /* */ } throw new Error(m); }
  return r.json();
}

function renderUploads() {
  const box = $("#uploads");
  if (!box) return;
  box.innerHTML = S.uploads.filter((u) => u.state !== "ok").map((u) => `
    <div class="card"><div class="row spread small"><b>${esc(u.name)}</b><span>${u.state === "erreur" ? esc(u.error) : `${fmtSize(u.done)} / ${fmtSize(u.size)} ${u.speed ? "· " + u.speed : ""}`}</span></div>
    <div class="progress"><div style="width:${((u.done / u.size) * 100).toFixed(1)}%"></div></div></div>`).join("")
    + (S.uploads.some((u) => u.state === "envoi") ? `<p class="muted small">Garde l'écran allumé et cette page ouverte. En cas de coupure, renvoie le même fichier : l'envoi reprend où il s'était arrêté.</p>` : "");
}

async function uploadFiles(files, endpoint, onDone) {
  let lock = null;
  try { lock = await navigator.wakeLock?.request("screen"); } catch { /* indisponible hors HTTPS */ }
  for (const f of files) {
    const u = { name: f.name, size: f.size || 1, done: 0, state: "envoi", speed: "" };
    S.uploads.push(u); renderUploads();
    try {
      let r = await putChunk(endpoint, f, 0, new Blob([]));
      let offset = r.offset, tries = 0;
      while (!r.done && offset < f.size) {
        const t0 = performance.now();
        try {
          const end = Math.min(offset + CHUNK, f.size);
          r = await putChunk(endpoint, f, offset, f.slice(offset, end));
          u.speed = `${((r.offset - offset) / 1e6 / ((performance.now() - t0) / 1000)).toFixed(0)} Mo/s`;
          offset = r.offset; tries = 0;
        } catch (e) {
          if (++tries > 8) throw e;
          await sleep(1500 * tries);
          try { r = await putChunk(endpoint, f, offset, new Blob([])); offset = r.offset; } catch { /* nouvel essai */ }
        }
        u.done = offset; renderUploads();
      }
      u.state = "ok"; u.done = u.size;
    } catch (e) { u.state = "erreur"; u.error = e.message; }
    renderUploads();
  }
  try { await lock?.release(); } catch { /* */ }
  if (onDone) await onDone();
}

// ------------------------------------------------------------ onglet Brief
function renderBrief() {
  const b = S.project.brief;
  const tons = ["dynamique et concret", "pédagogique (conseils de pro)", "inspirant, haut de gamme", "humour léger"];
  if (!tons.includes(b.ton)) tons.unshift(b.ton);
  const musics = ["", ...S.info.music];
  $("#tab").innerHTML = `
    <div class="card stack">
      <div class="grid2">
        <label class="field"><span>Sujet / chantier</span><input data-b="sujet" value="${esc(b.sujet)}" placeholder="Création d'un jardin, pose de gazon…"></label>
        <label class="field"><span>Ville / zone</span><input data-b="ville" value="${esc(b.ville)}"></label>
        <label class="field"><span>Ton</span><select data-b="ton">${tons.map((t) => `<option ${t === b.ton ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
        <label class="field"><span>Appel à l'action</span><input data-b="cta" value="${esc(b.cta)}"></label>
        <label class="field"><span>Nombre de clips</span><input type="number" min="1" max="8" data-b="nb_clips" value="${b.nb_clips}"></label>
        <label class="field"><span>Durée cible (secondes)</span><input type="number" min="8" max="180" data-b="duree" value="${b.duree}"></label>
        <label class="field"><span>Musique par défaut</span><select data-b="musique">${musics.map((m) => `<option value="${esc(m)}" ${m === b.musique ? "selected" : ""}>${m ? esc(m) : "Sans musique"}</option>`).join("")}</select></label>
      </div>
      <label class="btn" style="align-self:flex-start">🎵 Ajouter une musique libre de droits<input type="file" id="mupl" accept="audio/*" hidden></label>
      <p class="muted small">Dossier musique : ${esc(S.info.music_dir)}. Sur un compte professionnel, Instagram et TikTok limitent l'accès aux musiques commerciales : pour un son tendance, ajoute-le dans l'appli au moment de publier.</p>
      <label class="field"><span>Consignes pour l'agent</span><textarea data-b="notes" placeholder="Ex. mettre en avant le robot de tonte, ne pas montrer le visage du client…">${esc(b.notes)}</textarea></label>
      <div class="row"><button id="bsave">Enregistrer</button><button class="primary" id="bplan">✨ Enregistrer et proposer les montages</button></div>
    </div>`;
  const collect = () => Object.fromEntries($$("[data-b]").map((el) => [el.dataset.b, el.type === "number" ? Number(el.value) : el.value]));
  const save = async () => { S.project.brief = await api(`${pidUrl()}/brief`, { method: "PUT", body: collect() }); };
  $("#bsave").onclick = () => save().then(() => toast("Brief enregistré")).catch((e) => toast(e.message));
  $("#bplan").onclick = async () => {
    try { await save(); await startPlan(); } catch (e) { toast(e.message); }
  };
  $("#mupl").onchange = (e) => uploadFiles([...e.target.files], "/api/music/upload", async () => {
    S.info = await api("/api/info"); renderBrief(); toast("Musique ajoutée");
  });
}

async function startPlan() {
  const unsaved = S.project.clips.some((c) => c.status !== "rendu");
  if (unsaved && !confirm("Les clips non rendus seront remplacés par les nouvelles propositions. Continuer ?")) return;
  await api(`${pidUrl()}/plan`, { method: "POST" });
  toast("L'agent prépare les montages…");
  pollJobs(true);
  location.hash = `#/p/${S.project.id}/clips`;
}

// ------------------------------------------------------------ onglet Clips
function draft(cid) {
  if (!S.drafts[cid]) S.drafts[cid] = structuredClone(S.project.clips.find((c) => c.id === cid));
  return S.drafts[cid];
}
const clipTotal = (d) => d.segments.reduce((a, g) => a + (g.end - g.start), 0);

function segWords(g) {
  if (g.audio !== "keep") return [];
  return (S.words[g.source] || []).filter(([, s, e]) => s >= g.start - 0.05 && e <= g.end + 0.05);
}

function renderClips() {
  const p = S.project;
  const ready = p.sources.some((s) => s.status === "pret");
  $("#tab").innerHTML = `
    <div class="card row spread">
      <div class="grow"><b>${p.clips.length} clip(s)</b><div class="muted">L'agent propose, tu ajustes, puis rendu final en pleine qualité depuis les rushs originaux.</div></div>
      <button id="plan" class="primary" ${ready ? "" : "disabled"}>✨ Proposer ${p.brief.nb_clips} montages</button>
      <button id="newclip">+ Clip vide</button>
    </div>
    ${ready ? "" : `<div class="warnbox">Ajoute et analyse des rushs avant de demander des montages.</div>`}
    ${p.clips.map((c) => `<div class="card" id="clip-${c.id}"></div>`).join("")}`;
  $("#plan").onclick = () => startPlan().catch((e) => toast(e.message));
  $("#newclip").onclick = async () => { await api(`${pidUrl()}/clips`, { method: "POST" }); await reload(); };
  p.clips.forEach((c) => renderClip(c.id));
}

function exportBlock(d) {
  if (!d.export) return "";
  const url = `/files/${S.project.id}/exports/${encodeURIComponent(d.export.file)}`;
  return `<div class="export stack" style="margin-top:12px">
    <b>Vidéo finale</b>
    <video controls playsinline preload="metadata" src="${url}?v=${d.export.at}"></video>
    <div class="row"><a class="btn primary" href="${url}?download=1" download>⬇︎ Télécharger (${fmtSize(d.export.size)})</a>
    <button data-copy="${d.id}">Copier légende + hashtags</button></div>
    ${d.status === "modifie" ? `<div class="warnbox">Modifié depuis ce rendu : relance le rendu final.</div>` : ""}
  </div>`;
}

function segRow(g, i, n) {
  const src = srcById(g.source), vis = g.overlay ? srcById(g.overlay.source) : src, voice = isVoice(src);
  const vt = g.overlay ? g.overlay.start : g.start, dur = g.end - g.start;
  const text = segWords(g).map((w) => w[0]).join(" ");
  return `<div class="seg" data-i="${i}">
    <img src="${frameUrl(vis.id, vt + Math.min(0.5, dur / 2))}" alt="" style="object-position:${(g.crop_x * 100).toFixed(0)}% 50%;object-fit:${g.framing === "fit" ? "contain" : "cover"}" onerror="this.style.visibility='hidden'">
    <div class="stack">
      <div class="row spread"><b>${i + 1}. ${voice ? "🎙 " : ""}${esc(src.label)} ${fmtT(g.start)}→${fmtT(g.end)} s <span class="muted">(${dur.toFixed(1)} s)</span></b>
        <span class="row"><button class="mini ghost" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Monter">↑</button><button class="mini ghost" data-act="down" ${i === n - 1 ? "disabled" : ""} aria-label="Descendre">↓</button><button class="mini ghost danger" data-act="del" aria-label="Supprimer">✕</button></span></div>
      ${text ? `<div class="txt">« ${esc(text)} »</div>` : ""}
      ${g.overlay ? `<div class="small">🎞 Illustration : ${esc(vis.label)} à ${fmtT(g.overlay.start)} s ${voice ? "" : `<button class="mini ghost" data-act="ovdel">retirer</button>`}</div>` : ""}
      ${g.why ? `<div class="muted small">💡 ${esc(g.why)}</div>` : ""}
      <div class="row">
        <span class="small">Début</span><button class="mini" data-act="s-">−</button><button class="mini" data-act="s+">+</button>
        <span class="small">Fin</span><button class="mini" data-act="e-">−</button><button class="mini" data-act="e+">+</button>
        ${voice ? "" : `<button class="mini" data-act="audio">${g.audio === "keep" ? "🔊 Son" : "🔇 Muet"}</button>`}
        <button class="mini" data-act="ov">${g.overlay ? "Changer l'illustration" : "+ Illustration"}</button>
        <select data-act="framing" style="width:auto;min-height:32px;padding:2px 6px">
          <option value="crop" ${g.framing !== "fit" ? "selected" : ""}>Recadrer</option>
          <option value="fit" ${g.framing === "fit" ? "selected" : ""}>Image entière</option></select>
      </div>
      ${g.framing !== "fit" ? `<label class="row small">Cadrage ⟷ <input type="range" min="0" max="1" step="0.05" value="${g.crop_x}" data-act="cropx" class="grow"></label>` : ""}
    </div>
  </div>`;
}

function markDirty(cid) {
  const d = draft(cid);
  d._dirty = true;
  const b = $(`[data-save="${cid}"]`);
  if (b) b.disabled = false;
  const info = $(`#info-${cid}`);
  if (info) info.innerHTML = clipInfo(d);
}
const clipInfo = (d) => `${esc(d.angle)} · ${fmtDur(clipTotal(d))} · ${d.segments.length} plans${d._dirty ? " · <b>non enregistré</b>" : ""}`;

function renderClip(cid) {
  const d = draft(cid), el = $(`#clip-${cid}`);
  if (!el) return;
  const musics = ["", ...S.info.music];
  el.innerHTML = `
    <div class="row spread"><input class="grow" data-f="title" value="${esc(d.title)}" style="font-weight:700"><span class="badge ${esc(d.status)}">${STATUS[d.status] || esc(d.status)}</span></div>
    <p class="muted" id="info-${cid}">${clipInfo(d)}</p>
    <div class="clip-layout">
      <div>
        <div class="phone" id="ph-${cid}">
          <video playsinline muted preload="none"></video>
          <div class="hook" hidden></div><div class="sub"></div><div class="time"></div>
          <div class="ctrl"><button data-play="${cid}" aria-label="Aperçu">▶</button></div>
        </div>
        <p class="muted small" style="text-align:center">Aperçu basse définition</p>
        ${exportBlock(d)}
      </div>
      <div class="stack">
        <label class="field"><span>Texte d'accroche (3 premières secondes)</span><input data-f="hook" value="${esc(d.hook)}"></label>
        <div id="segs-${cid}">${d.segments.map((g, i) => segRow(g, i, d.segments.length)).join("")}</div>
        <button class="mini" data-addseg="${cid}">+ Ajouter un plan</button>
        <label class="field"><span>Légende du post</span><textarea data-f="caption">${esc(d.caption)}</textarea></label>
        <label class="field"><span>Hashtags</span><input data-f="hashtags" value="${esc(d.hashtags.join(" "))}"></label>
        <div class="grid2">
          <label class="field"><span>Musique</span><select data-f="music">${musics.map((m) => `<option value="${esc(m)}" ${m === d.music ? "selected" : ""}>${m ? esc(m) : "Sans musique"}</option>`).join("")}</select></label>
          <label class="row"><input type="checkbox" data-f="subtitles" ${d.subtitles ? "checked" : ""} style="width:auto;min-height:0"> Sous-titres incrustés</label>
        </div>
        <div class="row">
          <button data-save="${cid}" ${d._dirty ? "" : "disabled"}>Enregistrer</button>
          <button class="primary" data-render="${cid}">🎞 Rendu final</button>
          <button class="ghost danger" data-delclip="${cid}">Supprimer</button>
        </div>
      </div>
    </div>`;

  $$("[data-f]", el).forEach((inp) => {
    inp.addEventListener(inp.type === "checkbox" || inp.tagName === "SELECT" ? "change" : "input", () => {
      const f = inp.dataset.f;
      d[f] = inp.type === "checkbox" ? inp.checked : f === "hashtags" ? inp.value.split(/[\s,]+/).filter(Boolean) : inp.value;
      markDirty(cid);
    });
  });
  $(`[data-play="${cid}"]`, el).onclick = () => playPreview(cid);
  $(`[data-save="${cid}"]`, el).onclick = () => saveClip(cid).then(() => toast("Enregistré")).catch((e) => toast(e.message));
  $(`[data-render="${cid}"]`, el).onclick = async () => {
    try {
      if (d._dirty) await saveClip(cid);
      await api(`${pidUrl()}/clips/${cid}/render`, { method: "POST" });
      toast("Rendu lancé"); pollJobs(true);
    } catch (e) { toast(e.message); }
  };
  $(`[data-delclip="${cid}"]`, el).onclick = async () => {
    if (!confirm("Supprimer ce clip ?")) return;
    await api(`${pidUrl()}/clips/${cid}`, { method: "DELETE" });
    delete S.drafts[cid]; await reload();
  };
  $(`[data-addseg="${cid}"]`, el).onclick = () => pickShot("Ajouter un plan", (src, sh) => {
    d.segments.push({ id: null, source: src.id, start: sh.start, end: Math.min(sh.end, sh.start + 4), audio: "mute",
      framing: "crop", crop_x: sh.sujet_x ?? 0.5, overlay: null, why: "ajout manuel" });
    markDirty(cid); renderSegs(cid);
  });
  const copyBtn = $(`[data-copy="${cid}"]`, el);
  if (copyBtn) copyBtn.onclick = () => copyText(`${d.caption}\n\n${d.hashtags.join(" ")}`);
  bindSegs(cid);
}

function renderSegs(cid) {
  const d = draft(cid);
  $(`#segs-${cid}`).innerHTML = d.segments.map((g, i) => segRow(g, i, d.segments.length)).join("");
  bindSegs(cid);
}

function bindSegs(cid) {
  const d = draft(cid), box = $(`#segs-${cid}`);
  box.onclick = (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const i = Number(b.closest(".seg").dataset.i), g = d.segments[i], src = srcById(g.source);
    const step = 0.2, maxEnd = src.info.duration;
    switch (b.dataset.act) {
      case "up": [d.segments[i - 1], d.segments[i]] = [d.segments[i], d.segments[i - 1]]; break;
      case "down": [d.segments[i + 1], d.segments[i]] = [d.segments[i], d.segments[i + 1]]; break;
      case "del": d.segments.splice(i, 1); break;
      case "s-": g.start = Math.max(0, g.start - step); break;
      case "s+": g.start = Math.min(g.end - 0.3, g.start + step); break;
      case "e-": g.end = Math.max(g.start + 0.3, g.end - step); break;
      case "e+": g.end = Math.min(maxEnd, g.end + step); break;
      case "audio": g.audio = g.audio === "keep" ? "mute" : "keep"; break;
      case "ovdel": g.overlay = null; break;
      case "ov":
        pickShot("Plan d'illustration (par-dessus la parole)", (osrc, sh) => {
          const len = g.end - g.start;
          if (osrc.info.duration < len) { toast("Ce rush est trop court pour couvrir ce segment"); return; }
          g.overlay = { source: osrc.id, start: Math.min(sh.start, osrc.info.duration - len) };
          g.crop_x = sh.sujet_x ?? 0.5;
          markDirty(cid); renderSegs(cid);
        });
        return;
      default: return;
    }
    if (g.overlay) { // l'illustration doit rester assez longue
      const osrc = srcById(g.overlay.source), len = g.end - g.start;
      g.overlay.start = Math.max(0, Math.min(g.overlay.start, osrc.info.duration - len));
    }
    g.start = Math.round(g.start * 100) / 100; g.end = Math.round(g.end * 100) / 100;
    markDirty(cid); renderSegs(cid);
  };
  box.onchange = (e) => {
    if (e.target.dataset.act !== "framing") return;
    d.segments[Number(e.target.closest(".seg").dataset.i)].framing = e.target.value;
    markDirty(cid); renderSegs(cid);
  };
  box.oninput = (e) => {
    if (e.target.dataset.act !== "cropx") return;
    const row = e.target.closest(".seg"), g = d.segments[Number(row.dataset.i)];
    g.crop_x = Number(e.target.value);
    $("img", row).style.objectPosition = `${g.crop_x * 100}% 50%`;
    if (PV && PV.cid === cid && PV.g === g) PV.vid.style.objectPosition = `${g.crop_x * 100}% 50%`;
    markDirty(cid);
  };
}

async function saveClip(cid) {
  const d = draft(cid);
  const body = { title: d.title, hook: d.hook, caption: d.caption, hashtags: d.hashtags, music: d.music,
    subtitles: d.subtitles, segments: d.segments };
  const saved = await api(`${pidUrl()}/clips/${cid}`, { method: "PUT", body });
  const idx = S.project.clips.findIndex((c) => c.id === cid);
  S.project.clips[idx] = saved;
  delete S.drafts[cid];
  stopPreview();
  renderClip(cid);
}

function pickShot(title, cb) {
  const srcs = S.project.sources.filter((s) => s.status === "pret" && s.shots && s.shots.length);
  openModal(title, `<input id="shotq" placeholder="Filtrer : drone, avant, pelouse, R02…">
    ${srcs.map((s) => `<h3 style="margin-top:14px">${esc(s.label)} · ${esc(s.name)}</h3>
      <div class="shots">${s.shots.map((sh) => shotCard(s, sh, true)).join("")}</div>`).join("")}`);
  $("#shotq").oninput = (e) => {
    const q = e.target.value.toLowerCase();
    $$(".shot", modalBody).forEach((b) => (b.hidden = !!q && !b.textContent.toLowerCase().includes(q)));
  };
  $$(".shot", modalBody).forEach((b) => (b.onclick = () => {
    const s = srcById(b.dataset.sid);
    closeModal();
    cb(s, s.shots.find((x) => x.id === b.dataset.shot));
  }));
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => toast("Copié"));
    return;
  }
  const ta = document.createElement("textarea"); // repli : http sur le réseau local
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("Copié"); } catch { toast("Copie impossible"); }
  ta.remove();
}

// ------------------------------------------------------------ aperçu (proxys)
let PV = null;

function stopPreview() {
  if (!PV) return;
  cancelAnimationFrame(PV.raf);
  PV.vid.pause(); PV.aud.pause(); PV.aud.removeAttribute("src");
  PV.ph.classList.remove("playing");
  const b = $(`[data-play="${PV.cid}"]`); if (b) b.textContent = "▶";
  $$(".seg.playing").forEach((e) => e.classList.remove("playing"));
  PV = null;
}

function loadAt(media, url, t) {
  return new Promise((resolve) => {
    const go = () => {
      media.addEventListener("seeked", resolve, { once: true });
      media.currentTime = t;
      setTimeout(resolve, 2000);
    };
    if (!media.src.endsWith(url)) {
      media.src = url;
      media.addEventListener("loadedmetadata", go, { once: true });
      media.load();
    } else go();
  });
}

async function playPreview(cid) {
  if (PV && PV.cid === cid) { stopPreview(); return; }
  stopPreview();
  const d = draft(cid);
  if (!d.segments.length) return;
  const ph = $(`#ph-${cid}`);
  PV = { cid, ph, vid: $("video", ph), aud: new Audio(), i: -1, g: null, raf: 0, busy: false, total: clipTotal(d) };
  PV.vid.preload = "auto";
  ph.classList.add("playing");
  $(`[data-play="${cid}"]`).textContent = "■";
  await gotoSeg(0);
  tick();
}

async function gotoSeg(i) {
  const pv = PV;
  if (!pv) return;
  const d = draft(pv.cid);
  if (i >= d.segments.length) { stopPreview(); return; }
  pv.busy = true;
  const g = d.segments[i];
  pv.i = i; pv.g = g;
  pv.offset = d.segments.slice(0, i).reduce((a, x) => a + x.end - x.start, 0);
  pv.vt = g.overlay ? g.overlay.start : g.start;
  $$(`#segs-${pv.cid} .seg`).forEach((e, k) => e.classList.toggle("playing", k === i));
  pv.vid.style.objectFit = g.framing === "fit" ? "contain" : "cover";
  pv.vid.style.objectPosition = `${g.crop_x * 100}% 50%`;
  pv.vid.pause(); pv.aud.pause();
  const waits = [loadAt(pv.vid, proxyUrl(g.overlay ? g.overlay.source : g.source), pv.vt)];
  if (g.audio === "keep") waits.push(loadAt(pv.aud, proxyUrl(g.source), g.start));
  await Promise.all(waits);
  if (PV !== pv) return;
  pv.vid.play().catch(() => {});
  if (g.audio === "keep") pv.aud.play().catch(() => {});
  pv.busy = false;
}

function tick() {
  const pv = PV;
  if (!pv) return;
  pv.raf = requestAnimationFrame(tick);
  if (pv.busy) return;
  const g = pv.g, local = pv.vid.currentTime - pv.vt, dur = g.end - g.start;
  if (local >= dur - 0.03 || pv.vid.ended) { gotoSeg(pv.i + 1); return; }
  const now = pv.offset + Math.max(0, local);
  const d = draft(pv.cid);
  const hook = $(".hook", pv.ph);
  hook.hidden = !(d.hook && now < 3);
  hook.textContent = d.hook;
  const sub = $(".sub", pv.ph);
  if (d.subtitles) {
    const words = segWords(g), t = g.start + local;
    let k = -1;
    words.forEach((w, j) => { if (w[1] <= t) k = j; });
    if (k >= 0 && t <= words[k][2] + 0.6) {
      const a = k - (k % 3);
      sub.innerHTML = words.slice(a, a + 3).map((w, j) => (a + j === k ? `<b>${esc(w[0])}</b>` : esc(w[0]))).join(" ");
    } else sub.innerHTML = "";
  } else sub.innerHTML = "";
  $(".time", pv.ph).textContent = `${fmtT(now)} / ${fmtT(pv.total)} s`;
}

// ------------------------------------------------------------ suivi des tâches
let pollTimer;
async function pollJobs(now = false) {
  clearTimeout(pollTimer);
  let active = false;
  try {
    const jobs = await api(`/api/jobs${S.project ? `?pid=${S.project.id}` : ""}`);
    const running = jobs.filter((j) => j.status === "en_cours" || j.status === "en_attente");
    active = running.length > 0;
    renderJobbar(running);
    for (const j of jobs) {
      const prev = S.seenJobs[j.id];
      S.seenJobs[j.id] = j.status;
      if (!prev || prev === j.status || !["termine", "erreur"].includes(j.status)) continue;
      toast(j.status === "erreur" ? `${j.label} : ${j.error}` : `${j.label} : terminé${j.cost ? ` (≈ ${j.cost.toFixed(2)} $ d'API)` : ""}`, j.status === "erreur" ? 9000 : 4000);
      if (S.project && j.pid === S.project.id) {
        if (j.kind === "plan" && j.status === "termine") S.drafts = {};
        if (j.kind === "rendu") Object.keys(S.drafts).forEach((k) => { if (!S.drafts[k]._dirty) delete S.drafts[k]; });
        S.info = await api("/api/info"); renderStatus();
        if (!PV) await reload();
      }
    }
    const analysing = running.some((j) => j.kind === "analyse" && j.pid === S.project?.id);
    if (analysing && S.tab === "rushs" && Date.now() - S.lastReload > 6000 && !S.uploads.some((u) => u.state === "envoi")) await reload();
  } catch { /* serveur arrêté : on réessaie */ }
  pollTimer = setTimeout(pollJobs, active || now ? 1500 : 5000);
}

function renderJobbar(running) {
  const bar = $("#jobbar");
  const j = running.find((x) => x.status === "en_cours") || running[0];
  if (!j) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<div class="inner stack">
    <div class="row spread small"><b>${esc(j.label)}</b><span>${Math.round(j.progress * 100)} %${running.length > 1 ? ` · ${running.length - 1} en attente` : ""}</span></div>
    <div class="progress"><div style="width:${j.progress * 100}%"></div></div>
    <div class="muted small">${esc(j.message || "En attente…")}</div></div>`;
}

// ------------------------------------------------------------ démarrage
(async () => {
  try { S.info = await api("/api/info"); } catch (e) { app.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
  renderStatus();
  route();
  pollJobs();
})();
