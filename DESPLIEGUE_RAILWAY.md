# Desplegar en Railway (GitHub → Railway)

Este repositorio ya trae todo lo necesario: `Dockerfile` (Node + Claude Code + poppler), `docker-entrypoint.sh` (permisos del volumen) y `railway.json` (healthcheck, 1 réplica, reinicio ante fallos). Railway lo construye solo.

> **Estado:** pensado para **pruebas** con la suscripción Pro (`CLAUDE_CODE_OAUTH_TOKEN`). Seguridad y redes (red privada, restricción de IP, rotación de token) quedan para una segunda fase.

## 1. Subir a GitHub

Desde la carpeta del servidor (si es la raíz del repo):

```bash
git init
git add .
git status        # comprueba que NO aparecen .env, node_modules/ ni data/
git commit -m "feat: add simulated filling server with Claude Code and Railway deployment"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/<tu-repo>.git
git push -u origin main
```

Si prefieres **repositorio privado** (recomendado: aunque no lleva secretos, es código interno), créalo así en GitHub.
Si metes esta carpeta dentro de un repositorio más grande, en Railway indica *Root Directory* = la ruta de la carpeta (paso 3).

## 2. Generar el token de tu suscripción (en tu PC)

1. Instala Claude Code en tu PC si no lo tienes: `npm install -g @anthropic-ai/claude-code`.
2. Ejecuta `claude setup-token` e inicia sesión con la cuenta **Pro** en el navegador que se abre.
3. Copia el token que imprime (suele empezar por `sk-ant-oat…`). **Es una credencial: no lo pegues en chats, no lo subas a GitHub.** Solo irá a las variables de Railway.
4. Es de larga duración pero **no se renueva solo**: si un día el servidor responde «Not logged in», genera uno nuevo y actualiza la variable.

## 3. Crear el servicio en Railway

1. Railway → **New Project** → **Deploy from GitHub repo** → elige tu repo (autoriza el acceso de Railway a GitHub si lo pide).
2. Si la carpeta no es la raíz del repo: servicio → **Settings → Source → Root Directory**.
3. Railway detecta `railway.json` y construye con el `Dockerfile` (la primera construcción tarda unos minutos).

## 4. Volumen (para no perder los trabajos al redesplegar)

Servicio → **Settings → Volumes** (o `Ctrl/⌘+K` → *Add Volume*) → **Mount path:** `/data`.

Sin volumen funciona, pero cada redespliegue borra paquetes, resultados y estados.

## 5. Variables (servicio → **Variables**)

| Variable | Valor |
|---|---|
| `SERVIDOR_TOKEN` | Una clave larga y aleatoria. Genérala con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. La plataforma la enviará como `Authorization: Bearer …`. **Obligatoria**: sin ella (o con menos de 16 caracteres) el servidor no arranca. |
| `IA` | `claude` |
| `CLAUDE_CODE_OAUTH_TOKEN` | El token del paso 2 |
| `CLAUDE_MODELO` | `sonnet` (cuida la cuota; `opus` gasta mucho más) |
| `WEBHOOK_SECRETO` | Opcional (otra clave aleatoria) si más adelante usas el webhook |

Ya vienen por defecto en la imagen: `DATA_DIR=/data`, `RETENCION_DIAS=2`, `NODE_ENV=production`. `PORT` lo pone Railway. El resto de opciones están en `.env.example`.

> Para probar sin gastar cuota: `IA=simulada` (devuelve los valores del ejemplo del paquete).

## 6. Dirección pública

Servicio → **Settings → Networking → Generate Domain**. Si pide el puerto, usa el que aparece en los logs
(`Servidor … escuchando en el puerto NNNN`). Railway define `RAILWAY_PUBLIC_DOMAIN` y el servidor arma solo el enlace de descarga con ese dominio.

## 7. Verificar

```bash
# Salud: debe verse "listo_para_llenar": true y "credencial": "token_de_suscripcion"
curl https://<tu-dominio>.up.railway.app/v1/salud

# La credencial de Claude funciona (una llamada mínima real a tu suscripción):
curl -X POST -H "Authorization: Bearer <SERVIDOR_TOKEN>" https://<tu-dominio>.up.railway.app/v1/diagnostico/claude
# → {"ok":true,"respuesta":"OK",…}
```

Y la conexión de **Claude Code con el Excel** (lo que usa el llenado real: Claude Code abre una herramienta, mira una hoja y responde):

```bash
curl -X POST -H "Authorization: Bearer <SERVIDOR_TOKEN>" https://<tu-dominio>.up.railway.app/v1/diagnostico/claude-excel
# → {"ok":true,"mensaje":"Claude Code llamó a la herramienta del Excel y leyó la celda B1.","respuesta":"MANZANA-42",…}
# Si "ok" es false: Claude respondió sin usar la herramienta (permisos o conexión MCP). Pásame el JSON completo.
```

Si el diagnóstico dice `Not logged in`, revisa `CLAUDE_CODE_OAUTH_TOKEN` (sin comillas ni espacios). Si dice `limite_de_uso_ia`, se agotó la ventana de la suscripción.

## 8. Primera prueba real (acotada, desde tu PC)

```bash
npm install
npm run probar -- ejemplos/paquete_entrada_ejemplo_fte-cuidado-diurno.zip \
  --url https://<tu-dominio>.up.railway.app --token <SERVIDOR_TOKEN> \
  --secciones 02,06 --max-unidades 4
```

`--secciones` y `--max-unidades` limitan el llenado para no gastar la cuota en la primera corrida (lo omitido queda sin llenar a propósito y se anota en `advertencias`). Si todo va bien, repite sin límites con un paquete real generado por la plataforma.

## 9. Cosas a tener presentes

- **Una sola réplica** (no escalar): el estado vive en el volumen de esa instancia.
- **Un redespliegue o reinicio corta los trabajos en curso**; al volver quedan en `error` (reintentable) y hay que reenviarlos.
- **Cuota Pro compartida** con tu uso normal de Claude: una ficha completa de Educación (~40 llamadas) puede agotar la ventana de 5 h.
- **Datos de clientes**: el servidor guarda los paquetes recibidos hasta `RETENCION_DIAS` (2 por defecto) o hasta que la plataforma llame a `DELETE /v1/trabajos/{id}`.
- **Logs**: Railway → servicio → *Deployments → View logs*. No se imprimen contenidos de documentos; cada trabajo deja además `log.ndjson` en el volumen.
- **Siguiente paso (otra unidad):** conectar el backend de la plataforma a esta URL con el mismo `SERVIDOR_TOKEN`.

## 10. Probar el chat desde tu PC (UI React)

Tras redesplegar con los endpoints de chat (haz `git push` y espera a que Railway quede **Active**):

```bash
cd chat-ui-prueba        # carpeta de la UI (en la raíz del proyecto, fuera de este repo)
npm install
npm run dev              # http://localhost:5173
```

En **Servidor** (ajustes) pon la URL de Railway y tu `SERVIDOR_TOKEN`, y usa **Probar con Claude**. El servidor ya permite CORS a `localhost:5173/5174`; si usas otro puerto u origen, añade la variable `CORS_ORIGENES` (lista separada por comas, p. ej. `http://localhost:3000`).

Con el **volumen** montado en `/data`, las conversaciones y las sesiones de Claude sobreviven a los redespliegues; sin él se pierden (el chat sigue funcionando: reconstruye el contexto con el historial mientras exista).
