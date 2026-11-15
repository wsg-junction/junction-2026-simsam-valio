import path from 'node:path';
process.env.PORT = '8791';
process.env.PUBLIC_URL = 'http://localhost:8791';
process.env.WEB_DIR = path.resolve('.recording/web-dist');
process.env.DATA_DIR = path.resolve('video/work/demo-data');
process.env.GEMINI_API_KEY = '';
process.env.VALIO_API_KEY = '';
await import('../apps/mcp/dist/server.js');
