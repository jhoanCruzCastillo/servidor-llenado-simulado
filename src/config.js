import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const env = process.env;
const num = (v, def) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : def;
};

// Railway inyecta PORT; en local se usa PUERTO (o 8090).
const puerto = num(env.PUERTO ?? env.PORT, 8090);
const enProduccion = env.NODE_ENV === 'production';

export const config = {
  puerto,
  token: env.SERVIDOR_TOKEN || 'dev-token-cambiar',
  enProduccion,
  // Con dominio público en Railway se usa ese; si el servidor es solo de red privada, define URL_PUBLICA a mano
  // (p. ej. http://servidor-llenado.railway.internal:8080) para que el enlace de descarga lo alcance la plataforma.
  urlPublica: (env.URL_PUBLICA || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${puerto}`)).replace(/\/+$/, ''),
  // Ruta corta: el paquete trae rutas largas (>200 caracteres) y Windows corta en 260.
  // En Railway: el volumen (RAILWAY_VOLUME_MOUNT_PATH). En local: ruta corta en tu carpeta de usuario.
  dataDir: env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || join(homedir(), '.proyectafacil-sim'),
  limitePaqueteMB: num(env.LIMITE_PAQUETE_MB, 300),
  versionServidor: '1.0.0',
  versionesPaqueteSoportadas: ['1.0'],

  ia: (env.IA || 'claude').toLowerCase(), // 'claude' | 'simulada'
  claude: {
    bin: env.CLAUDE_BIN || 'claude',
    // Los argumentos que son rutas de archivos existentes se vuelven absolutos: Claude se lanza con otro directorio de trabajo.
    binArgs: (env.CLAUDE_BIN_ARGS || '').split(' ').filter(Boolean).map((a) => (existsSync(a) ? resolve(a) : a)),
    modelo: env.CLAUDE_MODELO || 'sonnet',
    esfuerzo: env.CLAUDE_ESFUERZO || '',
    maxTurnos: num(env.CLAUDE_MAX_TURNOS, 40),
    timeoutMs: num(env.CLAUDE_TIMEOUT_MIN, 20) * 60_000,
    // Por defecto se IGNORA ANTHROPIC_API_KEY para que Claude Code use la suscripción. Con 1 se respeta (se paga por API).
    permitirApiKey: env.PERMITIR_API_KEY === '1',
  },
  simulada: { demoraMs: num(env.SIMULADA_DEMORA_MS, 400) },

  // Chat de prueba (UI en React): respuestas simultáneas permitidas y orígenes web que pueden llamar a la API (CORS).
  chatConcurrencia: Math.max(1, num(env.CHAT_CONCURRENCIA, 2)),
  corsOrigenes: (env.CORS_ORIGENES || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),

  tablasPorLlamada: Math.max(1, num(env.TABLAS_POR_LLAMADA, 4)),
  maxCaracteresPorLlamada: num(env.MAX_CARACTERES_POR_LLAMADA, 45_000),
  reintentos: Math.max(0, num(env.REINTENTOS, 2)),
  concurrenciaTrabajos: Math.max(1, num(env.CONCURRENCIA_TRABAJOS, 1)),
  retencionDias: Math.min(7, Math.max(1, num(env.RETENCION_DIAS, 7))),
  webhookSecreto: env.WEBHOOK_SECRETO || 'dev-secreto-webhook',
  expiraResultadoHoras: num(env.EXPIRA_RESULTADO_HORAS, 24 * 7),
};
