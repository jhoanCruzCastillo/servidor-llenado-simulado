import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizServidor = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

  ia: (env.IA || 'claude').toLowerCase(), // 'claude' | 'simulada' | 'local'
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
    // skill-host/ es el archivo de la skill MEF vieja (MCP): no se inyecta.
    skillHost: env.SKILL_HOST ? resolve(env.SKILL_HOST) : join(raizServidor, 'skill-host'),
    // Proceso aprendido del llenado real (COM, pasadas, mapa FTE-EBR-V03). Se inyecta con --add-dir.
    skillAprendido: env.SKILL_APRENDIDO
      ? resolve(env.SKILL_APRENDIDO)
      : join(raizServidor, 'conocimiento-plantillas'),
  },
  simulada: { demoraMs: num(env.SIMULADA_DEMORA_MS, 400) },
  // IA local (Ollama). Ver src/ia/local.js.
  local: {
    url: (env.OLLAMA_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    // gpt-oss-20b ganó el banco de prueba (Desktop/LLM/README.md): 95 % frente a 89 % de Qwen3-30B-A3B (`pf-llenado`), en la mitad de tiempo.
    modelo: env.LOCAL_MODELO || 'gpt-oss:20b',
    // Se manda en cada llamada (pisa el del Modelfile). Las instrucciones de una sección ya ocupan ~17k tokens (Qwen3 da ~2 caracteres
    // por token en español), así que 32k no alcanza. 64k con Qwen3-30B-A3B ≈ 3,2 GB de caché si Ollama la guarda en 8 bits
    // (OLLAMA_FLASH_ATTENTION=1 y OLLAMA_KV_CACHE_TYPE=q8_0); sin eso, ~6,4 GB.
    numCtx: num(env.LOCAL_NUM_CTX, 65536),
    // Tokens que se dejan libres para la respuesta (una sección entera de campos en una llamada a llenar_campos).
    reservaSalida: num(env.LOCAL_RESERVA_SALIDA, 6000),
    maxTurnos: num(env.LOCAL_MAX_TURNOS, 30),
    timeoutMs: num(env.LOCAL_TIMEOUT_MIN, 30) * 60_000,
    // Carpeta del paquete de herramientas (Desktop/LLM/herramientas): documentos con OCR y web. Vacío = sin esas herramientas.
    herramientasDir: env.HERRAMIENTAS_LOCAL ? resolve(env.HERRAMIENTAS_LOCAL) : '',
    web: env.LOCAL_WEB !== '0',
    // Tope por lectura de documento: ~4k tokens, para que varios quepan en el contexto.
    maxCaracteresHerramienta: num(env.LOCAL_MAX_CARACTERES_HERRAMIENTA, 12_000),
    // Bloques de instrucciones/contexto más grandes que esto no se pegan en el prompt: se citan con su ruta (ver compactar en local.js).
    maxTokensBloque: num(env.LOCAL_MAX_TOKENS_BLOQUE, 4000),
  },
  // 'excel': el resultado es el Excel llenado (Claude Code lo ve y lo llena con herramientas; ver src/excel/). 'json': como antes, solo respuesta.json.
  salida: (env.SALIDA || 'excel').toLowerCase() === 'json' ? 'json' : 'excel',

  // Chat de prueba (UI en React): respuestas simultáneas permitidas y orígenes web que pueden llamar a la API (CORS).
  chatConcurrencia: Math.max(1, num(env.CHAT_CONCURRENCIA, 2)),
  chatMaxArchivoMB: Math.max(1, num(env.CHAT_MAX_ARCHIVO_MB, 100)),
  chatMaxArchivos: Math.max(1, num(env.CHAT_MAX_ARCHIVOS, 20)),
  corsOrigenes: (env.CORS_ORIGENES || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean),

  tablasPorLlamada: Math.max(1, num(env.TABLAS_POR_LLAMADA, 4)),
  maxCaracteresPorLlamada: num(env.MAX_CARACTERES_POR_LLAMADA, 45_000),
  reintentos: Math.max(0, num(env.REINTENTOS, 2)),
  concurrenciaTrabajos: Math.max(1, num(env.CONCURRENCIA_TRABAJOS, 1)),
  // Al recibir DELETE se borran los documentos del cliente y el paquete, pero (mientras se afina el servicio) se conservan el log, las respuestas crudas
  // de la IA y el resultado unos días para poder diagnosticar. CONSERVAR_DIAGNOSTICO=0 borra todo en el acto.
  conservarDiagnostico: env.CONSERVAR_DIAGNOSTICO !== '0',
  diagnosticoDias: Math.max(1, num(env.DIAGNOSTICO_DIAS, 3)),
  retencionDias: Math.min(7, Math.max(1, num(env.RETENCION_DIAS, 7))),
  webhookSecreto: env.WEBHOOK_SECRETO || 'dev-secreto-webhook',
  expiraResultadoHoras: num(env.EXPIRA_RESULTADO_HORAS, 24 * 7),
};
