/**
 * Servidor MCP mínimo para comprobar, con Claude Code de verdad, que la conexión herramientas ↔ Excel funciona (POST /v1/diagnostico/claude-excel).
 * Solo expone ver_hoja sobre un Excel de prueba diminuto; no necesita un paquete. Uso: node mcp-prueba.js <excel.xlsx>
 */
for (const m of ['log', 'info', 'warn', 'debug']) console[m] = (...a) => console.error(...a);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { verHoja } from '../../vendor/excel-ficha.mjs';

const excel = process.argv[2];
const server = new McpServer({ name: 'excel_ficha', version: '1.0.0' });
server.registerTool(
  'ver_hoja',
  { description: 'Muestra el contenido de una hoja del Excel de prueba.', inputSchema: { hoja: z.string(), rango: z.string().optional() } },
  async ({ hoja, rango }) => ({ content: [{ type: 'text', text: await verHoja({ excel, hoja, rango }) }] }),
);
await server.connect(new StdioServerTransport());
