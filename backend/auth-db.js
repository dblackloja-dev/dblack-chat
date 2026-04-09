// Salva credenciais do WhatsApp no banco de dados em vez de arquivos
// Isso permite que o Railway (ou qualquer plataforma sem disco persistente) mantenha a sessão
const { proto } = require('@whiskeysockets/baileys');
const { queryOne, queryRun, queryAll } = require('./database');

async function initAuthTable() {
  await queryRun(`
    CREATE TABLE IF NOT EXISTS wa_auth (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

async function useDBAuthState() {
  await initAuthTable();

  // Lê credenciais salvas
  const readData = async (key) => {
    const row = await queryOne("SELECT value FROM wa_auth WHERE key = $1", [key]);
    if (!row) return null;
    try {
      const parsed = JSON.parse(row.value, (k, v) => {
        if (typeof v === 'object' && v !== null && v.type === 'Buffer' && Array.isArray(v.data)) {
          return Buffer.from(v.data);
        }
        return v;
      });
      return parsed;
    } catch { return null; }
  };

  const writeData = async (key, data) => {
    const value = JSON.stringify(data, (k, v) => {
      if (Buffer.isBuffer(v)) return { type: 'Buffer', data: Array.from(v) };
      return v;
    });
    await queryRun(
      "INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [key, value]
    );
  };

  const removeData = async (key) => {
    await queryRun("DELETE FROM wa_auth WHERE key = $1", [key]);
  };

  // Carrega creds
  const creds = await readData('creds') || {};

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const result = {};
          for (const id of ids) {
            const data = await readData(`${type}-${id}`);
            if (data) {
              if (type === 'app-state-sync-key') {
                result[id] = proto.Message.AppStateSyncKeyData.fromObject(data);
              } else {
                result[id] = data;
              }
            }
          }
          return result;
        },
        set: async (data) => {
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              if (value) {
                await writeData(`${type}-${id}`, value);
              } else {
                await removeData(`${type}-${id}`);
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
  };
}

module.exports = { useDBAuthState };
