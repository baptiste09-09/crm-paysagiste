// Remplace l'API window.storage (spécifique aux artefacts Claude.ai) par une
// implémentation basée sur localStorage, avec la même interface asynchrone.
// -> get() renvoie null si la clé n'existe pas (jamais d'exception pour une clé absente).

const PREFIX = "crm-paysagiste:";

export const storage = {
  async get(key) {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw === null) return null;
      return { key, value: raw };
    } catch (e) {
      // localStorage indisponible (navigation privée stricte, quota, etc.)
      return null;
    }
  },

  async set(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },

  async delete(key) {
    try {
      window.localStorage.removeItem(PREFIX + key);
      return { key, deleted: true };
    } catch (e) {
      return null;
    }
  },

  async list(prefix = "") {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(PREFIX + prefix)) keys.push(k.slice(PREFIX.length));
      }
      return { keys };
    } catch (e) {
      return { keys: [] };
    }
  },
};
