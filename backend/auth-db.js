// Salva credenciais do WhatsApp no banco de dados (PostgreSQL)
// Usa BufferJSON do Baileys para serialização correta de chaves criptográficas
const { proto, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const { queryOne, queryRun } = require('./database');

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

  const readData = async (key) => {
    const row = await queryOne("SELECT value FROM wa_auth WHERE key = $1", [key]);
    if (!row) return null;
    try {
      return JSON.parse(row.value, BufferJSON.reviver);
    } catch { return null; }
  };

  const writeData = async (key, data) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await queryRun(
      "INSERT INTO wa_auth (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [key, value]
    );
  };

  const removeData = async (key) => {
    await queryRun("DELETE FROM wa_auth WHERE key = $1", [key]);
  };

  // Carrega credenciais existentes ou cria novas
  const creds = (await readData('creds')) || initAuthCreds();

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
          const tasks = [];
          for (const [type, entries] of Object.entries(data)) {
            for (const [id, value] of Object.entries(entries)) {
              if (value) {
                tasks.push(writeData(`${type}-${id}`, value));
              } else {
                tasks.push(removeData(`${type}-${id}`));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    },
  };
}

module.exports = { useDBAuthState };
