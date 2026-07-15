import React, { useState, useEffect, useCallback } from "react";
import { Leaf, MapPin, Phone, Mail, Plus, Check, Clock, ChevronLeft, ChevronRight, Search, X, Trash2, Sparkles, Upload, AlertCircle, Download } from "lucide-react";
import { API_BASE } from "./config";
import { storage } from "./storage";
import { deriveKey, encryptJSON, decryptJSON } from "./crypto";
import { addDays, formatDate, formatDateLong, getTodayIso } from "./utils/date";
import { pullSync, pushSync } from "./sync";

// ---- Design tokens ----
// Couleurs : vert sapin (#25332A), mousse (#5B7A52), pierre/argile (#B7A480),
// papier carnet (#EFEDE2), encre (#1C2620), ambre récolte (#C08A2E)
// Typo : Fraunces (display) + IBM Plex Sans (corps) + IBM Plex Mono (données/dates)

const FONT_LINK = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

const STATUS = {
  prospect: { label: "Prospect", color: "#C08A2E" },
  actif: { label: "Actif", color: "#5B7A52" },
  termine: { label: "Terminé", color: "#8B8378" },
};

const uid = () => Math.random().toString(36).slice(2, 10);

function useFontLoader() {
  useEffect(() => {
    if (!document.getElementById("crm-fonts")) {
      const link = document.createElement("link");
      link.id = "crm-fonts";
      link.rel = "stylesheet";
      link.href = FONT_LINK;
      document.head.appendChild(link);
    }
  }, []);
}

const seedClients = () => ([
  {
    id: uid(),
    name: "Famille Bertrand",
    address: "14 rue des Tilleuls, Meudon",
    phone: "06 12 34 56 78",
    email: "bertrand.j@mail.fr",
    gardenType: "Jardin paysager, 400m²",
    status: "actif",
    notes: "Taille de haies préférée le matin. Chien dans le jardin — prévenir avant de venir.",
    history: [
      { id: uid(), date: "2026-05-12", note: "Tonte + taille des rosiers" },
      { id: uid(), date: "2026-04-02", note: "Installation d'un massif de vivaces" },
    ],
  },
  {
    id: uid(),
    name: "Copropriété Les Acacias",
    address: "8 avenue Foch, Clamart",
    phone: "01 45 67 89 10",
    email: "syndic.acacias@gestion.fr",
    gardenType: "Espaces verts collectifs, 1200m²",
    status: "actif",
    notes: "Facturation au syndic. Passage tous les 15 jours en saison.",
    history: [{ id: uid(), date: "2026-06-01", note: "Entretien mensuel des massifs" }],
  },
  {
    id: uid(),
    name: "M. Lefevre",
    address: "3 impasse des Chênes, Sèvres",
    phone: "07 88 99 00 11",
    email: "",
    gardenType: "Terrasse + petit jardin",
    status: "prospect",
    notes: "Devis demandé pour création d'une allée en gravier.",
    history: [],
  },
]);

const seedTasks = (clients) => ([
  { id: uid(), clientId: clients[0].id, title: "Taille des haies", due: "2026-07-15", done: false },
  { id: uid(), clientId: clients[1].id, title: "Tonte espaces verts", due: "2026-07-14", done: false },
  { id: uid(), clientId: clients[2].id, title: "Envoyer devis allée gravier", due: "2026-07-16", done: false },
  { id: uid(), clientId: clients[0].id, title: "Rappeler pour arrosage automatique", due: "2026-07-20", done: false },
]);

function LockScreen({ hasPin, onUnlocked, onReset }) {
  const [step, setStep] = useState(hasPin ? "enter" : "create-1");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useFontLoader();

  async function handleCreate(value) {
    const p = value !== undefined ? value : pin;
    if (p.length < 4) { setError("Le code doit contenir au moins 4 chiffres."); return; }
    setStep("create-2");
  }

  async function handleConfirmCreate(value) {
    const p2 = value !== undefined ? value : pin2;
    if (p2 !== pin) { setError("Les deux codes ne correspondent pas."); setPin2(""); return; }
    setBusy(true);
    try {
      const { key, saltB64 } = await deriveKey(pin, null);
      const verifier = await encryptJSON(key, { check: "ok" });
      await storage.set("security-meta", JSON.stringify({ saltB64, verifier }));
      onUnlocked(key);
    } catch (e) {
      setError("Erreur lors de la création du verrouillage.");
      setBusy(false);
    }
  }

  async function handleEnter(value) {
    const p = value !== undefined ? value : pin;
    setBusy(true);
    setError("");
    try {
      const metaRaw = await storage.get("security-meta");
      if (!metaRaw) throw new Error("no-meta");
      const meta = JSON.parse(metaRaw.value);
      const { key } = await deriveKey(p, meta.saltB64);
      const check = await decryptJSON(key, meta.verifier);
      if (check.check === "ok") {
        onUnlocked(key);
      } else {
        throw new Error("bad");
      }
    } catch (e) {
      setError("Code incorrect.");
      setPin("");
      setBusy(false);
    }
  }

  const shell = {
    fontFamily: "'IBM Plex Sans', sans-serif", background: "#25332A", height: "100vh",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    color: "#EFEDE2", padding: 24, gap: 18,
  };
  const dotsWrap = { display: "flex", gap: 12, margin: "6px 0 4px" };
  const dotStyle = (filled) => ({
    width: 14, height: 14, borderRadius: "50%",
    background: filled ? "#C08A2E" : "transparent", border: "1.5px solid #8B9A87",
  });
  const keypadStyle = { display: "grid", gridTemplateColumns: "repeat(3, 56px)", gap: 12, marginTop: 10 };
  const keyStyle = {
    width: 56, height: 56, borderRadius: "50%", border: "1px solid #3A4B3D", background: "#2E3F31",
    color: "#EFEDE2", fontSize: 19, fontFamily: "'IBM Plex Mono', monospace", cursor: "pointer",
  };

  function Keypad({ value, setValue, onSubmit }) {
    return (
      <div style={keypadStyle}>
        {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k, i) => {
          if (k === "") return <div key={i} />;
          return (
            <button key={i} style={keyStyle} onClick={() => {
              setError("");
              if (k === "⌫") setValue(value.slice(0, -1));
              else if (value.length < 6) {
                const next = value + k;
                setValue(next);
                if (next.length >= 4 && next.length === 6) onSubmit?.(next);
              }
            }}>{k}</button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={shell}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap');
      `}</style>
      <Leaf size={30} color="#5B7A52" />
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600, textAlign: "center" }}>
        {step === "enter" && "Déverrouille ton carnet"}
        {step === "create-1" && "Crée un code de verrouillage"}
        {step === "create-2" && "Confirme ton code"}
      </div>
      <div style={{ fontSize: 12.5, color: "#B7C9AC", textAlign: "center", maxWidth: 260 }}>
        {step === "create-1" && "Ce code chiffre tes données clients localement. Personne ne peut le récupérer à ta place — retiens-le bien."}
        {step === "create-2" && "Ressaisis le même code pour confirmer."}
        {step === "enter" && "Tes données sont chiffrées et stockées uniquement sur cet appareil."}
      </div>

      <div style={dotsWrap}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={dotStyle(i < (step === "create-2" ? pin2.length : pin.length))} />
        ))}
      </div>

      {step === "enter" && <Keypad value={pin} setValue={setPin} onSubmit={handleEnter} />}
      {step === "create-1" && <Keypad value={pin} setValue={setPin} onSubmit={handleCreate} />}
      {step === "create-2" && <Keypad value={pin2} setValue={setPin2} onSubmit={handleConfirmCreate} />}

      {step === "enter" && pin.length >= 4 && pin.length < 6 && !busy && (
        <button onClick={() => handleEnter(pin)} style={{ ...keyStyle, width: "auto", borderRadius: 20, padding: "0 22px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}>Valider</button>
      )}
      {step === "create-1" && pin.length >= 4 && pin.length < 6 && (
        <button onClick={() => handleCreate(pin)} style={{ ...keyStyle, width: "auto", borderRadius: 20, padding: "0 22px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}>Valider</button>
      )}
      {step === "create-2" && pin2.length >= 4 && pin2.length < 6 && !busy && (
        <button onClick={() => handleConfirmCreate(pin2)} style={{ ...keyStyle, width: "auto", borderRadius: 20, padding: "0 22px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}>Valider</button>
      )}

      {error && <div style={{ color: "#E08A7D", fontSize: 12.5 }}>{error}</div>}
      {busy && <div style={{ color: "#B7C9AC", fontSize: 12.5 }}>Vérification…</div>}

      {step === "enter" && (
        <button onClick={onReset} style={{ background: "none", border: "none", color: "#8B9A87", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", marginTop: 8 }}>
          Code oublié ? Réinitialiser (efface les données)
        </button>
      )}
      {step === "create-2" && (
        <button onClick={() => { setStep("create-1"); setPin(""); setPin2(""); setError(""); }} style={{ background: "none", border: "none", color: "#8B9A87", fontSize: 11.5, textDecoration: "underline", cursor: "pointer", marginTop: 8 }}>
          Recommencer
        </button>
      )}
    </div>
  );
}

export default function CRMPaysagiste() {
  useFontLoader();
  const [clients, setClients] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [view, setView] = useState({ page: "dashboard" });
  const [search, setSearch] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showAIImport, setShowAIImport] = useState(false);
  const [prefillData, setPrefillData] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const [unlocked, setUnlocked] = useState(false);
  const [cryptoKey, setCryptoKey] = useState(null);
  const [hasPin, setHasPin] = useState(null); // null = inconnu, true/false une fois vérifié

  // ---- Synchronisation entre appareils ----
  const [lastModified, setLastModified] = useState(0);
  const [syncCode, setSyncCode] = useState(null); // null = pas encore chargé/défini
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | pushed | pulled | error
  const [showSyncSetup, setShowSyncSetup] = useState(false);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const meta = await storage.get("security-meta");
        setHasPin(!!meta);
      } catch (e) {
        setHasPin(false);
      }
    })();
  }, []);

  async function loadData(key) {
    // Chaque clé est lue et déchiffrée indépendamment : si l'une des deux échoue
    // (donnée corrompue, clé absente...), ça ne doit pas effacer l'autre.
    let cData;
    try {
      const c = await storage.get("clients");
      cData = c ? await decryptJSON(key, c.value) : seedClients();
    } catch (e) {
      cData = seedClients();
    }

    let tData;
    try {
      const t = await storage.get("tasks");
      tData = t ? await decryptJSON(key, t.value) : seedTasks(cData);
    } catch (e) {
      tData = seedTasks(cData);
    }

    setClients(cData);
    setTasks(tData);

    // Horodatage de dernière modification locale (utilisé pour la synchro).
    let lm = 0;
    try {
      const lmRaw = await storage.get("last-modified");
      lm = lmRaw ? parseInt(lmRaw.value, 10) || 0 : 0;
    } catch (e) {}
    setLastModified(lm);

    // Code de synchro déjà configuré sur cet appareil, s'il existe.
    try {
      const codeRaw = await storage.get("sync-code");
      setSyncCode(codeRaw ? codeRaw.value : "");
    } catch (e) {
      setSyncCode("");
    }

    try {
      const c = await storage.get("clients");
      if (!c) await storage.set("clients", await encryptJSON(key, cData));
      const t = await storage.get("tasks");
      if (!t) await storage.set("tasks", await encryptJSON(key, tData));
    } catch (e) {
      // pas grave : les données restent en mémoire, elles seront persistées
      // au prochain ajout/modif via persistClients/persistTasks.
    }

    setLoaded(true);
  }

  async function handleUnlocked(key) {
    setCryptoKey(key);
    setUnlocked(true);
    await loadData(key);
  }

  const bumpLastModified = useCallback(async () => {
    const now = Date.now();
    setLastModified(now);
    try { await storage.set("last-modified", String(now)); } catch (e) {}
    return now;
  }, []);

  const persistClients = useCallback(async (next) => {
    setClients(next);
    if (!cryptoKey) return;
    try { await storage.set("clients", await encryptJSON(cryptoKey, next)); } catch (e) {}
    await bumpLastModified();
  }, [cryptoKey, bumpLastModified]);

  const persistTasks = useCallback(async (next) => {
    setTasks(next);
    if (!cryptoKey) return;
    try { await storage.set("tasks", await encryptJSON(cryptoKey, next)); } catch (e) {}
    await bumpLastModified();
  }, [cryptoKey, bumpLastModified]);

  async function handleSync() {
    if (syncStatus === "syncing") return;
    if (!syncCode) {
      setShowSyncSetup(true);
      return;
    }
    setSyncStatus("syncing");
    setSyncError("");
    try {
      const remote = await pullSync(syncCode);
      if (!remote || lastModified >= remote.lastModified) {
        // Nos données sont plus récentes (ou aucune donnée distante encore) : on envoie.
        await pushSync(syncCode, { clients, tasks, lastModified });
        setSyncStatus("pushed");
      } else {
        // Les données distantes sont plus récentes : on demande avant d'écraser l'appareil actuel.
        const when = new Date(remote.lastModified).toLocaleString("fr-FR");
        const ok = window.confirm(
          `Des données plus récentes existent sur un autre appareil (mises à jour le ${when}).\n\n` +
          `Les récupérer remplacera les données présentes sur CET appareil. Continuer ?`
        );
        if (ok) {
          setClients(remote.data.clients);
          setTasks(remote.data.tasks);
          setLastModified(remote.lastModified);
          if (cryptoKey) {
            try {
              await storage.set("clients", await encryptJSON(cryptoKey, remote.data.clients));
              await storage.set("tasks", await encryptJSON(cryptoKey, remote.data.tasks));
              await storage.set("last-modified", String(remote.lastModified));
            } catch (e) {}
          }
          setSyncStatus("pulled");
        } else {
          setSyncStatus("idle");
        }
      }
    } catch (e) {
      setSyncError("La synchronisation a échoué. Vérifie ta connexion et réessaie.");
      setSyncStatus("error");
    }
    setTimeout(() => setSyncStatus("idle"), 4000);
  }

  async function handleSetSyncCode(code) {
    setSyncCode(code);
    try { await storage.set("sync-code", code); } catch (e) {}
    setShowSyncSetup(false);
    setTimeout(() => handleSync(), 100);
  }

  async function handleForgotPin() {
    try {
      await storage.delete("security-meta");
      await storage.delete("clients");
      await storage.delete("tasks");
    } catch (e) {}
    setHasPin(false);
  }

  if (hasPin === null) {
    return (
      <div style={{ fontFamily: "IBM Plex Sans, sans-serif", background: "#EFEDE2", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#25332A" }}>
        Chargement…
      </div>
    );
  }

  if (!unlocked) {
    return <LockScreen key={hasPin ? "has-pin" : "no-pin"} hasPin={hasPin} onUnlocked={handleUnlocked} onReset={handleForgotPin} />;
  }

  if (!loaded) {
    return (
      <div style={{ fontFamily: "IBM Plex Sans, sans-serif", background: "#EFEDE2", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#25332A" }}>
        Déchiffrement du carnet…
      </div>
    );
  }

  const clientById = (id) => clients.find((c) => c.id === id);
  const todayStr = getTodayIso();

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.address.toLowerCase().includes(search.toLowerCase())
  );

  const upcomingTasks = [...tasks]
    .filter((t) => !t.done)
    .sort((a, b) => a.due.localeCompare(b.due));

  function toggleTask(id) {
    persistTasks(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function deleteTask(id) {
    persistTasks(tasks.filter((t) => t.id !== id));
  }

  function addClient(data) {
    const { _reminder, ...clientFields } = data;
    const newId = uid();
    const next = [...clients, { id: newId, history: [], ...clientFields }];
    persistClients(next);
    if (_reminder) {
      const reminderTask = {
        id: uid(), clientId: newId,
        title: `Rappeler ${clientFields.name || "le prospect"} (demande de contact)`,
        due: addDays(todayStr, 2), startTime: "", endTime: "", done: false,
      };
      persistTasks([...tasks, reminderTask]);
    }
    setShowNewClient(false);
    setPrefillData(null);
  }

  function handleExtracted(data) {
    setPrefillData(data);
    setShowAIImport(false);
    setShowNewClient(true);
  }

  function deleteClient(id) {
    persistClients(clients.filter((c) => c.id !== id));
    persistTasks(tasks.filter((t) => t.clientId !== id));
    setView({ page: "dashboard" });
  }

  function addTask(data) {
    persistTasks([...tasks, { id: uid(), done: false, ...data }]);
    setShowNewTask(false);
  }

  function addHistoryNote(clientId, note, date) {
    persistClients(clients.map((c) =>
      c.id === clientId ? { ...c, history: [{ id: uid(), date, note }, ...c.history] } : c
    ));
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", background: "#EFEDE2", minHeight: "100vh", color: "#1C2620", display: "flex" }}>
      <style>{`
        * { box-sizing: border-box; }
        ::selection { background: #C08A2E33; }
        .nav-item:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible {
          outline: 2px solid #5B7A52; outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { transition: none !important; animation: none !important; }
        }
        .card-hover { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .card-hover:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(28,38,32,0.12); }
        @media (max-width: 720px) {
          .sidebar { display: none !important; }
          .mobile-nav { display: flex !important; }
        }
        .print-only { display: none; }
        @media print {
          .no-print, .sidebar, .mobile-nav { display: none !important; }
          .print-only { display: block !important; }
          body, .print-only { background: #fff !important; }
        }
      `}</style>

      <Sidebar view={view} setView={setView} className="no-print" onSync={handleSync} syncStatus={syncStatus} hasSyncCode={!!syncCode} />

      <main style={{ flex: 1, minWidth: 0, padding: "32px 28px 90px", maxWidth: 980, margin: "0 auto", width: "100%" }}>
        {view.page === "dashboard" && (
          <Dashboard
            clients={clients}
            upcomingTasks={upcomingTasks}
            todayStr={todayStr}
            clientById={clientById}
            toggleTask={toggleTask}
            deleteTask={deleteTask}
            setView={setView}
            onNewTask={() => setShowNewTask(true)}
          />
        )}

        {view.page === "clients" && (
          <ClientsList
            clients={filteredClients}
            search={search}
            setSearch={setSearch}
            setView={setView}
            onNewClient={() => setShowNewClient(true)}
            onAIImport={() => setShowAIImport(true)}
          />
        )}

        {view.page === "client" && (
          <ClientDetail
            client={clientById(view.id)}
            tasks={tasks.filter((t) => t.clientId === view.id)}
            setView={setView}
            toggleTask={toggleTask}
            deleteTask={deleteTask}
            deleteClient={deleteClient}
            addHistoryNote={addHistoryNote}
          />
        )}

        {view.page === "tasks" && (
          <TasksPage
            tasks={tasks}
            clientById={clientById}
            toggleTask={toggleTask}
            deleteTask={deleteTask}
            onNewTask={() => setShowNewTask(true)}
          />
        )}
      </main>

      <MobileNav view={view} setView={setView} />
      <PrintableCatalog clients={clients} />

      {showNewClient && (
        <ClientModal
          initialData={prefillData}
          onClose={() => { setShowNewClient(false); setPrefillData(null); }}
          onSave={addClient}
        />
      )}
      {showNewTask && (
        <TaskModal clients={clients} onClose={() => setShowNewTask(false)} onSave={addTask} />
      )}
      {showAIImport && (
        <AIImportModal onClose={() => setShowAIImport(false)} onExtracted={handleExtracted} />
      )}
      {showSyncSetup && (
        <SyncSetupModal
          existingCode={syncCode}
          error={syncError}
          onClose={() => setShowSyncSetup(false)}
          onSave={handleSetSyncCode}
        />
      )}
    </div>
  );
}

function Sidebar({ view, setView, onSync, syncStatus, hasSyncCode }) {
  const items = [
    { key: "dashboard", label: "Tableau de bord" },
    { key: "clients", label: "Clients" },
    { key: "tasks", label: "Tâches" },
  ];
  const syncLabel = {
    idle: hasSyncCode ? "Synchroniser" : "Configurer la synchro",
    syncing: "Synchronisation…",
    pushed: "✓ Envoyé",
    pulled: "✓ Récupéré",
    error: "Erreur — réessayer",
  }[syncStatus] || "Synchroniser";

  return (
    <aside className="sidebar" style={{
      width: 220, background: "#25332A", color: "#EFEDE2", padding: "28px 20px",
      display: "flex", flexDirection: "column", gap: 4, flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 36, paddingLeft: 4 }}>
        <Leaf size={22} color="#5B7A52" />
        <span style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 19, letterSpacing: 0.2 }}>
          Racines
        </span>
      </div>
      {items.map((it) => (
        <button
          key={it.key}
          className="nav-item"
          onClick={() => setView({ page: it.key })}
          style={{
            textAlign: "left", background: view.page === it.key ? "#3A4B3D" : "transparent",
            border: "none", color: "#EFEDE2", padding: "10px 12px", borderRadius: 6,
            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, cursor: "pointer",
            fontWeight: view.page === it.key ? 600 : 400,
          }}
        >
          {it.label}
        </button>
      ))}
      <button
        className="nav-item"
        onClick={onSync}
        disabled={syncStatus === "syncing"}
        style={{
          textAlign: "left", background: "transparent", border: "1px solid #3A4B3D", color: "#B7C9AC",
          padding: "10px 12px", borderRadius: 6, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13,
          cursor: syncStatus === "syncing" ? "default" : "pointer", marginTop: 14,
          opacity: syncStatus === "syncing" ? 0.7 : 1,
        }}
      >
        {syncLabel}
      </button>
      <div style={{ marginTop: "auto", fontSize: 11.5, color: "#8B9A87", paddingLeft: 4, lineHeight: 1.5 }}>
        Carnet de chantier
        <br />
        {formatDateLong(getTodayIso())}
      </div>
    </aside>
  );
}

function MobileNav({ view, setView }) {
  const items = [
    { key: "dashboard", label: "Accueil" },
    { key: "clients", label: "Clients" },
    { key: "tasks", label: "Tâches" },
  ];
  return (
    <nav className="mobile-nav" style={{
      display: "none", position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#25332A", padding: "10px 8px", justifyContent: "space-around", zIndex: 10,
    }}>
      {items.map((it) => (
        <button key={it.key} onClick={() => setView({ page: it.key })}
          style={{
            background: "none", border: "none", color: view.page === it.key ? "#C08A2E" : "#EFEDE2",
            fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: view.page === it.key ? 600 : 400,
            padding: "6px 14px", cursor: "pointer",
          }}>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontWeight: 600, fontSize: 28, margin: 0, color: "#1C2620" }}>
        {children}
      </h1>
      {action}
    </div>
  );
}

function PrimaryButton({ children, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      background: "#25332A", color: "#EFEDE2", border: "none", borderRadius: 6,
      padding: "9px 16px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 500,
      cursor: "pointer", display: "flex", alignItems: "center", gap: 6, ...style,
    }}>
      {children}
    </button>
  );
}

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.prospect;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5A5347", fontFamily: "'IBM Plex Mono', monospace" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, display: "inline-block" }} />
      {s.label}
    </span>
  );
}

function Dashboard({ clients, upcomingTasks, todayStr, clientById, toggleTask, deleteTask, setView, onNewTask }) {
  const actifs = clients.filter((c) => c.status === "actif").length;
  const prospects = clients.filter((c) => c.status === "prospect").length;
  const dueSoon = upcomingTasks.filter((t) => t.due <= todayStr);

  return (
    <div>
      <SectionTitle>Tableau de bord</SectionTitle>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14, marginBottom: 32 }}>
        <StatCard label="Clients actifs" value={actifs} />
        <StatCard label="Prospects" value={prospects} />
        <StatCard label="Tâches en retard" value={dueSoon.length} accent={dueSoon.length > 0} />
        <StatCard label="Tâches à venir" value={upcomingTasks.length - dueSoon.length} />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, margin: 0 }}>Prochaines interventions</h2>
        <PrimaryButton onClick={onNewTask}><Plus size={15} /> Tâche</PrimaryButton>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {upcomingTasks.length === 0 && (
          <EmptyState text="Aucune tâche en attente. Ajoute-en une pour organiser ta semaine." />
        )}
        {upcomingTasks.slice(0, 6).map((t) => (
          <TaskRow key={t.id} task={t} client={clientById(t.clientId)} todayStr={todayStr}
            onToggle={() => toggleTask(t.id)} onDelete={() => deleteTask(t.id)}
            onClientClick={() => setView({ page: "client", id: t.clientId })} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div style={{
      background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 8, padding: "16px 16px",
    }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 500, color: accent ? "#C08A2E" : "#25332A" }}>
        {value}
      </div>
      <div style={{ fontSize: 12.5, color: "#5A5347", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div style={{
      border: "1px dashed #C7C1AE", borderRadius: 8, padding: "22px 18px", color: "#7A7364",
      fontSize: 13.5, textAlign: "center",
    }}>
      {text}
    </div>
  );
}

function TaskRow({ task, client, todayStr, onToggle, onDelete, onClientClick }) {
  const late = !task.done && task.due < todayStr;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, background: "#F7F5EC",
      border: "1px solid #DCD8C8", borderRadius: 8, padding: "12px 14px",
    }}>
      <button onClick={onToggle} aria-label="Marquer comme terminée" style={{
        width: 20, height: 20, borderRadius: "50%", border: `1.5px solid ${task.done ? "#5B7A52" : "#B7A480"}`,
        background: task.done ? "#5B7A52" : "transparent", display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", flexShrink: 0,
      }}>
        {task.done && <Check size={12} color="#F7F5EC" />}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, textDecoration: task.done ? "line-through" : "none", color: task.done ? "#9A9284" : "#1C2620" }}>
          {task.title}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {client && (
            <button onClick={onClientClick} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12.5, color: "#5B7A52", textDecoration: "underline" }}>
              {client.name}
            </button>
          )}
          {(task.startTime || task.endTime) && (
            <span style={{ fontSize: 11.5, color: "#8B8378", fontFamily: "'IBM Plex Mono', monospace" }}>
              {task.startTime || "?"}{task.endTime ? `–${task.endTime}` : ""}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: late ? "#B5473F" : "#7A7364", whiteSpace: "nowrap" }}>
        {late && "⚠ "}{formatDate(task.due)}
      </div>
      <button onClick={onDelete} aria-label="Supprimer la tâche" style={{ background: "none", border: "none", cursor: "pointer", color: "#B0A996" }}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function PrintableCatalog({ clients }) {
  return (
    <div className="print-only" style={{ padding: 24, fontFamily: "'IBM Plex Sans', sans-serif", color: "#1C2620" }}>
      <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 20, marginBottom: 2 }}>Racines — Catalogue clients</h1>
      <div style={{ fontSize: 11, color: "#5A5347", marginBottom: 16 }}>Exporté le 13/07/2026 — {clients.length} client(s)</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            {["Nom", "Statut", "Adresse", "Téléphone", "Email", "Type de jardin", "Notes"].map((h) => (
              <th key={h} style={{ textAlign: "left", borderBottom: "1.5px solid #1C2620", padding: "6px 8px" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {clients.map((c) => (
            <tr key={c.id}>
              <td style={cellStyle}>{c.name}</td>
              <td style={cellStyle}>{(STATUS[c.status] || {}).label || c.status}</td>
              <td style={cellStyle}>{c.address}</td>
              <td style={cellStyle}>{c.phone}</td>
              <td style={cellStyle}>{c.email}</td>
              <td style={cellStyle}>{c.gardenType}</td>
              <td style={cellStyle}>{c.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
const cellStyle = { padding: "6px 8px", borderBottom: "1px solid #DCD8C8", verticalAlign: "top" };

function ClientsList({ clients, search, setSearch, setView, onNewClient, onAIImport }) {
  return (
    <div>
      <SectionTitle action={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PrimaryButton onClick={onAIImport} style={{ background: "#5B7A52" }}>
            <Sparkles size={15} /> Fiche via IA
          </PrimaryButton>
          <PrimaryButton onClick={onNewClient}><Plus size={15} /> Client</PrimaryButton>
          <PrimaryButton onClick={() => window.print()} style={{ background: "#7A6A45" }}>
            <Download size={15} /> Catalogue PDF
          </PrimaryButton>
        </div>
      }>
        Clients
      </SectionTitle>

      <div className="no-print" style={{ fontSize: 11.5, color: "#8B8378", marginTop: -12, marginBottom: 16 }}>
        Le bouton ouvre la boîte de dialogue d'impression — choisis "Enregistrer en PDF" comme destination.
      </div>

      <div style={{ position: "relative", marginBottom: 20 }}>
        <Search size={15} style={{ position: "absolute", left: 12, top: 11, color: "#8B8378" }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un nom ou une adresse…"
          style={{
            width: "100%", padding: "9px 12px 9px 34px", borderRadius: 7, border: "1px solid #CFC9B8",
            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, background: "#F7F5EC",
          }}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {clients.length === 0 && <EmptyState text="Aucun client ne correspond à cette recherche." />}
        {clients.map((c) => (
          <button key={c.id} className="card-hover" onClick={() => setView({ page: "client", id: c.id })}
            style={{
              textAlign: "left", background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 10,
              padding: "16px 16px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif",
            }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 15.5, color: "#1C2620" }}>{c.name}</div>
              <StatusDot status={c.status} />
            </div>
            <div style={{ fontSize: 12.5, color: "#7A7364", display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
              <MapPin size={12} /> {c.address}
            </div>
            <div style={{ fontSize: 12.5, color: "#7A7364" }}>{c.gardenType}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function ClientDetail({ client, tasks, setView, toggleTask, deleteTask, deleteClient, addHistoryNote }) {
  const [noteText, setNoteText] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!client) {
    return (
      <div>
        <button onClick={() => setView({ page: "clients" })} style={backLinkStyle}><ChevronLeft size={15} /> Retour</button>
        <EmptyState text="Ce client n'existe plus." />
      </div>
    );
  }

  function submitNote() {
    if (!noteText.trim()) return;
    addHistoryNote(client.id, noteText.trim(), getTodayIso());
    setNoteText("");
  }

  return (
    <div>
      <button onClick={() => setView({ page: "clients" })} style={backLinkStyle}><ChevronLeft size={15} /> Retour aux clients</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
        <h1 style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, margin: 0 }}>{client.name}</h1>
        <StatusDot status={client.status} />
      </div>
      <div style={{ fontSize: 13, color: "#7A7364", marginBottom: 24 }}>{client.gardenType}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
        <InfoLine icon={<MapPin size={14} />} text={client.address} />
        <InfoLine icon={<Phone size={14} />} text={client.phone || "Non renseigné"} />
        <InfoLine icon={<Mail size={14} />} text={client.email || "Non renseigné"} />
      </div>

      {client.notes && (
        <div style={{ background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 8, padding: "12px 14px", fontSize: 13.5, color: "#3A362E", marginBottom: 28, lineHeight: 1.5 }}>
          {client.notes}
        </div>
      )}

      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Tâches liées</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
        {tasks.length === 0 && <EmptyState text="Aucune tâche liée à ce client." />}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} client={null} todayStr={getTodayIso()} onToggle={() => toggleTask(t.id)} onDelete={() => deleteTask(t.id)} onClientClick={() => {}} />
        ))}
      </div>

      <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 600, marginBottom: 10 }}>Historique des interventions</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Ajouter une note d'intervention…"
          style={{ flex: 1, padding: "8px 12px", borderRadius: 6, border: "1px solid #CFC9B8", fontSize: 13.5, fontFamily: "'IBM Plex Sans', sans-serif", background: "#F7F5EC" }} />
        <PrimaryButton onClick={submitNote}>Ajouter</PrimaryButton>
      </div>
      <div style={{ borderLeft: "2px solid #DCD8C8", paddingLeft: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {client.history.length === 0 && <div style={{ fontSize: 13, color: "#8B8378" }}>Pas encore d'intervention enregistrée.</div>}
        {client.history.map((h) => (
          <div key={h.id}>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: "#5B7A52" }}>{formatDate(h.date)}</div>
            <div style={{ fontSize: 13.5, color: "#3A362E" }}>{h.note}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid #DCD8C8" }}>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} style={{ background: "none", border: "none", color: "#B5473F", fontSize: 13, cursor: "pointer", padding: 0 }}>
            Supprimer ce client
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#5A5347" }}>Supprimer définitivement {client.name} ?</span>
            <button onClick={() => deleteClient(client.id)} style={{ background: "#B5473F", color: "#fff", border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 12.5, cursor: "pointer" }}>Confirmer</button>
            <button onClick={() => setConfirmDelete(false)} style={{ background: "none", border: "1px solid #CFC9B8", borderRadius: 5, padding: "5px 10px", fontSize: 12.5, cursor: "pointer" }}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}

const backLinkStyle = {
  display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
  color: "#5B7A52", fontSize: 13, cursor: "pointer", padding: 0, marginBottom: 18, fontFamily: "'IBM Plex Sans', sans-serif",
};

function InfoLine({ icon, text }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#3A362E" }}>
      <span style={{ color: "#8B8378" }}>{icon}</span>{text}
    </div>
  );
}

function TasksPage({ tasks, clientById, toggleTask, deleteTask, onNewTask }) {
  const [mode, setMode] = useState("liste"); // liste | calendrier
  const [selectedDay, setSelectedDay] = useState(null);
  const sorted = [...tasks].sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due) || (a.startTime || "").localeCompare(b.startTime || ""));

  const dayTasks = selectedDay ? sorted.filter((t) => t.due === selectedDay) : sorted;

  return (
    <div>
      <SectionTitle action={<PrimaryButton onClick={onNewTask}><Plus size={15} /> Tâche</PrimaryButton>}>
        Tâches
      </SectionTitle>

      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: "#E4E0D0", borderRadius: 7, padding: 3, width: "fit-content" }}>
        {["liste", "calendrier"].map((m) => (
          <button key={m} onClick={() => { setMode(m); setSelectedDay(null); }} style={{
            border: "none", borderRadius: 5, padding: "6px 16px", fontSize: 13, cursor: "pointer",
            fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 500,
            background: mode === m ? "#25332A" : "transparent", color: mode === m ? "#EFEDE2" : "#5A5347",
          }}>
            {m === "liste" ? "Liste" : "Calendrier"}
          </button>
        ))}
      </div>

      {mode === "calendrier" && (
        <MonthCalendar tasks={sorted} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
      )}

      {mode === "calendrier" && selectedDay && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "18px 0 10px" }}>
          <h3 style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, margin: 0 }}>
            {formatDateLong(selectedDay)}
          </h3>
          <button onClick={() => setSelectedDay(null)} style={{ background: "none", border: "none", color: "#5B7A52", fontSize: 12.5, cursor: "pointer" }}>
            Voir tout
          </button>
        </div>
      )}

      {mode === "calendrier" && selectedDay ? (
        <DaySchedule
          tasks={dayTasks}
          clientById={clientById}
          toggleTask={toggleTask}
          deleteTask={deleteTask}
          selectedDay={selectedDay}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: mode === "liste" ? 0 : 4 }}>
          {dayTasks.length === 0 && <EmptyState text="Aucune tâche pour le moment." />}
          {dayTasks.map((t) => (
            <TaskRow key={t.id} task={t} client={clientById(t.clientId)} todayStr={getTodayIso()}
              onToggle={() => toggleTask(t.id)} onDelete={() => deleteTask(t.id)} onClientClick={() => {}} />
          ))}
        </div>
      )}
    </div>
  );
}

const sectionLabelStyle = {
  fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, letterSpacing: 1,
  textTransform: "uppercase", color: "#8B8378", marginBottom: 8,
};

function DaySchedule({ tasks, clientById, toggleTask, deleteTask, selectedDay }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000); // rafraîchit toutes les 30s
    return () => clearInterval(id);
  }, []);

  const pad = (v) => String(v).padStart(2, "0");
  const nowStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const realTodayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isToday = selectedDay === realTodayIso;

  const withTime = tasks.filter((t) => t.startTime);
  const noTime = tasks.filter((t) => !t.startTime);
  const morning = withTime.filter((t) => t.startTime < "12:00").sort((a, b) => a.startTime.localeCompare(b.startTime));
  const afternoon = withTime.filter((t) => t.startTime >= "12:00").sort((a, b) => a.startTime.localeCompare(b.startTime));

  function renderGroup(label, groupTasks, isNowRange) {
    const showLine = isToday && isNowRange;
    let lineInserted = false;
    return (
      <div style={{ marginBottom: 22 }}>
        <div style={sectionLabelStyle}>{label}</div>
        {groupTasks.length === 0 && !showLine && (
          <div style={{ fontSize: 12.5, color: "#B0A996", paddingLeft: 2 }}>Rien de prévu</div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {groupTasks.map((t) => {
            const insertBefore = showLine && !lineInserted && t.startTime > nowStr;
            if (insertBefore) lineInserted = true;
            return (
              <React.Fragment key={t.id}>
                {insertBefore && <NowLine time={nowStr} />}
                <TaskRow task={t} client={clientById(t.clientId)} todayStr={realTodayIso}
                  onToggle={() => toggleTask(t.id)} onDelete={() => deleteTask(t.id)} onClientClick={() => {}} />
              </React.Fragment>
            );
          })}
          {showLine && !lineInserted && <NowLine time={nowStr} />}
        </div>
      </div>
    );
  }

  return (
    <div>
      {noTime.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <div style={sectionLabelStyle}>Sans horaire précisé</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {noTime.map((t) => (
              <TaskRow key={t.id} task={t} client={clientById(t.clientId)} todayStr={realTodayIso}
                onToggle={() => toggleTask(t.id)} onDelete={() => deleteTask(t.id)} onClientClick={() => {}} />
            ))}
          </div>
        </div>
      )}
      {renderGroup("Matin", morning, nowStr < "12:00")}
      {renderGroup("Après-midi", afternoon, nowStr >= "12:00")}
    </div>
  );
}

function NowLine({ time }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 0" }}>
      <div style={{ flex: 1, height: 2, background: "#C08A2E", borderRadius: 1 }} />
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#C08A2E", fontWeight: 600, whiteSpace: "nowrap" }}>
        maintenant · {time}
      </span>
      <div style={{ flex: 1, height: 2, background: "#C08A2E", borderRadius: 1 }} />
    </div>
  );
}

function MonthCalendar({ tasks, selectedDay, onSelectDay }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });

  const { year, month } = cursor;
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay.getDay() + 6) % 7; // lundi = 0

  const tasksByDay = {};
  tasks.forEach((t) => {
    tasksByDay[t.due] = (tasksByDay[t.due] || 0) + 1;
  });

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const weekLabels = ["L", "M", "M", "J", "V", "S", "D"];
  const monthLabel = firstDay.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const todayIso = getTodayIso();
  const navBtnStyle = {
    border: "1px solid #DCD8C8", background: "#fff", borderRadius: 6, width: 26, height: 26,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#5A5347",
  };

  function goToMonth(delta) {
    setCursor(({ year, month }) => {
      const d = new Date(year, month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    onSelectDay(null);
  }

  return (
    <div style={{ background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => goToMonth(-1)} style={navBtnStyle} aria-label="Mois précédent"><ChevronLeft size={15} /></button>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, textTransform: "capitalize" }}>
          {monthLabel}
        </div>
        <button onClick={() => goToMonth(1)} style={navBtnStyle} aria-label="Mois suivant"><ChevronRight size={15} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 6 }}>
        {weekLabels.map((w, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11, color: "#8B8378", fontFamily: "'IBM Plex Mono', monospace" }}>{w}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const count = tasksByDay[iso] || 0;
          const isSelected = selectedDay === iso;
          const isToday = iso === todayIso;
          return (
            <button key={i} onClick={() => onSelectDay(isSelected ? null : iso)} style={{
              aspectRatio: "1", border: isToday ? "1.5px solid #C08A2E" : "1px solid #E2DECF",
              borderRadius: 6, background: isSelected ? "#25332A" : "#fff", cursor: "pointer",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: 2,
            }}>
              <span style={{ fontSize: 12.5, color: isSelected ? "#EFEDE2" : "#1C2620", fontFamily: "'IBM Plex Mono', monospace" }}>{d}</span>
              {count > 0 && (
                <span style={{
                  width: 5, height: 5, borderRadius: "50%",
                  background: isSelected ? "#C08A2E" : "#5B7A52",
                }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(28,38,32,0.45)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16,
    }}>
      <div style={{ background: "#EFEDE2", borderRadius: 12, padding: 24, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", cursor: "pointer", color: "#7A7364" }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 6, border: "1px solid #CFC9B8",
  fontSize: 13.5, fontFamily: "'IBM Plex Sans', sans-serif", background: "#F7F5EC", marginBottom: 12,
};
const labelStyle = { fontSize: 12, color: "#5A5347", marginBottom: 4, display: "block", fontWeight: 500 };

function ClientModal({ onClose, onSave, initialData }) {
  const [form, setForm] = useState({
    name: "", address: "", phone: "", email: "", gardenType: "", status: "prospect", notes: "",
    ...(initialData || {}),
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <ModalShell title={initialData ? "Vérifier la fiche extraite" : "Nouveau client"} onClose={onClose}>
      {initialData && (
        <div style={{
          background: "#EFEDE2", border: "1px solid #B7C9AC", borderRadius: 6, padding: "9px 11px",
          fontSize: 12, color: "#3F5A38", marginBottom: 14, display: "flex", gap: 7, alignItems: "flex-start",
        }}>
          <Sparkles size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Champs extraits automatiquement — vérifie-les avant d'enregistrer, l'IA peut se tromper.
        </div>
      )}
      {initialData?._reminder && (
        <div style={{
          background: "#FBF1DD", border: "1px solid #E3C685", borderRadius: 6, padding: "9px 11px",
          fontSize: 12, color: "#7A5A18", marginBottom: 14, display: "flex", gap: 7, alignItems: "flex-start",
        }}>
          <Clock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          Une tâche "Rappeler ce prospect" sera créée automatiquement à J+2, car l'email demande un contact.
        </div>
      )}
      <label style={labelStyle}>Nom</label>
      <input style={inputStyle} value={form.name} onChange={set("name")} placeholder="Famille Dupont" />
      <label style={labelStyle}>Adresse</label>
      <input style={inputStyle} value={form.address} onChange={set("address")} placeholder="12 rue des Lilas, ville" />
      <label style={labelStyle}>Téléphone</label>
      <input style={inputStyle} value={form.phone} onChange={set("phone")} placeholder="06 00 00 00 00" />
      <label style={labelStyle}>Email</label>
      <input style={inputStyle} value={form.email} onChange={set("email")} placeholder="client@mail.fr" />
      <label style={labelStyle}>Type de jardin</label>
      <input style={inputStyle} value={form.gardenType} onChange={set("gardenType")} placeholder="Jardin, terrasse, espace vert…" />
      <label style={labelStyle}>Statut</label>
      <select style={inputStyle} value={form.status} onChange={set("status")}>
        <option value="prospect">Prospect</option>
        <option value="actif">Actif</option>
        <option value="termine">Terminé</option>
      </select>
      <label style={labelStyle}>Notes</label>
      <textarea style={{ ...inputStyle, minHeight: 70 }} value={form.notes} onChange={set("notes")} placeholder="Préférences, accès, remarques…" />
      <PrimaryButton style={{ width: "100%", justifyContent: "center" }} onClick={() => form.name.trim() && onSave(form)}>
        Enregistrer le client
      </PrimaryButton>
    </ModalShell>
  );
}

function AIImportModal({ onClose, onExtracted }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | error
  const [errorMsg, setErrorMsg] = useState("");

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt")) {
      setErrorMsg("Seuls les fichiers .txt sont lisibles ici. Pour les PDF, voir la note ci-dessous.");
      setStatus("error");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ""));
    reader.readAsText(file);
  }

  async function analyze() {
    if (!text.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      // Le texte de l'email part vers NOTRE backend (server/index.js), qui seul
      // détient la clé Anthropic et interroge l'API. Le navigateur ne voit jamais la clé.
      const response = await fetch(`${API_BASE}/extract-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 6000) }),
      });
      if (!response.ok) throw new Error("request-failed");
      const parsed = await response.json();
      onExtracted({
        name: parsed.name || "",
        address: parsed.address || "",
        phone: parsed.phone || "",
        email: parsed.email || "",
        gardenType: parsed.gardenType || "",
        status: parsed.status === "actif" ? "actif" : "prospect",
        notes: parsed.notes || "",
        _reminder: parsed.requestsContact === true,
      });
    } catch (e) {
      setErrorMsg("L'extraction a échoué — le texte est peut-être trop désorganisé. Tu peux réessayer ou remplir la fiche à la main.");
      setStatus("error");
    }
  }

  return (
    <ModalShell title="Créer une fiche via l'IA" onClose={onClose}>
      <div style={{
        background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 6, padding: "9px 11px",
        fontSize: 12, color: "#7A7364", marginBottom: 14, display: "flex", gap: 7,
      }}>
        <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        Ici, seuls le texte collé et les fichiers .txt sont analysés. Dans l'app déployée, le PDF sera pris en charge directement.
      </div>

      <label style={labelStyle}>Coller le texte de l'email</label>
      <textarea
        style={{ ...inputStyle, minHeight: 130 }}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Bonjour, je vous contacte pour un devis concernant..."
      />

      <label style={labelStyle}>Ou importer un fichier .txt</label>
      <label style={{
        display: "flex", alignItems: "center", gap: 8, border: "1px dashed #C7C1AE", borderRadius: 6,
        padding: "10px 12px", fontSize: 13, color: "#5A5347", cursor: "pointer", marginBottom: 12,
      }}>
        <Upload size={14} />
        {fileName || "Choisir un fichier…"}
        <input type="file" accept=".txt" onChange={handleFile} style={{ display: "none" }} />
      </label>

      {status === "error" && (
        <div style={{ fontSize: 12.5, color: "#B5473F", marginBottom: 12 }}>{errorMsg}</div>
      )}

      <PrimaryButton
        style={{ width: "100%", justifyContent: "center", opacity: status === "loading" ? 0.7 : 1 }}
        onClick={analyze}
      >
        {status === "loading" ? "Analyse en cours…" : <><Sparkles size={15} /> Analyser et pré-remplir</>}
      </PrimaryButton>
    </ModalShell>
  );
}

function TaskModal({ clients, onClose, onSave }) {
  const [form, setForm] = useState({ title: "", clientId: clients[0]?.id || "", due: getTodayIso(), startTime: "", endTime: "" });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <ModalShell title="Nouvelle tâche" onClose={onClose}>
      <label style={labelStyle}>Description</label>
      <input style={inputStyle} value={form.title} onChange={set("title")} placeholder="Tonte, taille, devis…" />
      <label style={labelStyle}>Client concerné</label>
      <select style={inputStyle} value={form.clientId} onChange={set("clientId")}>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label style={labelStyle}>Date prévue</label>
      <input type="date" style={inputStyle} value={form.due} onChange={set("due")} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={labelStyle}>Heure de début</label>
          <input type="time" style={inputStyle} value={form.startTime} onChange={set("startTime")} />
        </div>
        <div>
          <label style={labelStyle}>Heure de fin</label>
          <input type="time" style={inputStyle} value={form.endTime} onChange={set("endTime")} />
        </div>
      </div>
      <PrimaryButton style={{ width: "100%", justifyContent: "center" }} onClick={() => form.title.trim() && onSave(form)}>
        Ajouter la tâche
      </PrimaryButton>
    </ModalShell>
  );
}

function SyncSetupModal({ existingCode, error, onClose, onSave }) {
  const [code, setCode] = useState(existingCode || "");
  const [confirmCode, setConfirmCode] = useState("");
  const isFirstTime = !existingCode;

  function submit() {
    if (code.trim().length < 6) return;
    if (isFirstTime && code !== confirmCode) return;
    onSave(code.trim());
  }

  return (
    <ModalShell title="Synchroniser entre appareils" onClose={onClose}>
      <div style={{
        background: "#F7F5EC", border: "1px solid #DCD8C8", borderRadius: 6, padding: "9px 11px",
        fontSize: 12.5, color: "#5A5347", marginBottom: 14, lineHeight: 1.5,
      }}>
        Choisis une phrase secrète connue seulement de tes appareils (au moins 6 caractères).
        Elle chiffre tes données avant l'envoi — le serveur ne les voit jamais en clair.
        Utilise la <strong>même phrase</strong> sur ton téléphone et ton ordinateur.
      </div>

      <label style={labelStyle}>Code de synchronisation</label>
      <input
        type="password"
        style={inputStyle}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Une phrase que tu retiendras"
      />

      {isFirstTime && (
        <>
          <label style={labelStyle}>Confirme le code</label>
          <input
            type="password"
            style={inputStyle}
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value)}
            placeholder="Retape la même phrase"
          />
        </>
      )}

      {code.trim().length > 0 && code.trim().length < 6 && (
        <div style={{ fontSize: 12.5, color: "#B5473F", marginBottom: 10 }}>
          Au moins 6 caractères.
        </div>
      )}
      {isFirstTime && confirmCode.length > 0 && confirmCode !== code && (
        <div style={{ fontSize: 12.5, color: "#B5473F", marginBottom: 10 }}>
          Les deux codes ne correspondent pas.
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12.5, color: "#B5473F", marginBottom: 10 }}>{error}</div>
      )}

      <PrimaryButton style={{ width: "100%", justifyContent: "center" }} onClick={submit}>
        Enregistrer et synchroniser
      </PrimaryButton>
    </ModalShell>
  );
}
