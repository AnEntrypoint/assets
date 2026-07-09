const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Single-file mode (back-compat):  node render-glb.js <in.glb> <out.png> [w] [h]
// Batch mode:                      node render-glb.js --batch <pairs.json> [w] [h]
//   pairs.json = [[inputGlb, outputPng], ...]
// Batch mode launches ONE browser and reuses it across all models, which is
// dramatically faster than the old spawn-a-browser-per-model shell loop
// (each cold chromium.launch() + CDN fetch dominated render time).

const args = process.argv.slice(2);
const batchMode = args[0] === '--batch';

async function renderOne(page, glbPath, outputPng, width, height, server) {
  const glbBytes = fs.readFileSync(path.resolve(glbPath));
  server.currentBytes = glbBytes;
  await page.setViewportSize({ width, height });
  await page.setContent(`<!DOCTYPE html><html><head>
<style>*{margin:0;padding:0;background:#1a1a1a}body{width:${width}px;height:${height}px;overflow:hidden}</style>
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js"></script>
</head><body>
<model-viewer id="mv" src="http://127.0.0.1:${server.port}/model.glb?t=${Date.now()}"
  style="width:${width}px;height:${height}px;background-color:#1a1a1a"
  shadow-intensity="1" exposure="1.2" tone-mapping="commerce">
</model-viewer>
</body></html>`);

  await page.waitForFunction(() => {
    const mv = document.querySelector('#mv');
    return mv && mv.loaded;
  }, { timeout: 30000 }).catch(() => {});

  await page.waitForTimeout(400);
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  await page.screenshot({ path: outputPng });
}

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/model.glb')) {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Access-Control-Allow-Origin': '*' });
      res.end(server.currentBytes);
    } else {
      res.writeHead(404); res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.port = server.address().port;
      resolve(server);
    });
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl',
    ],
  });
  const server = await startServer();
  const page = await browser.newPage();

  if (batchMode) {
    const pairs = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const width = Number(args[2] || '256'), height = Number(args[3] || '256');
    let ok = 0, failed = 0;
    for (const [inputGlb, outputPng] of pairs) {
      try {
        await renderOne(page, inputGlb, outputPng, width, height, server);
        ok++;
      } catch (e) {
        console.error(`WARN: failed ${inputGlb}: ${e.message}`);
        failed++;
      }
    }
    console.log(`[render-glb] ${ok} rendered, ${failed} failed`);
  } else {
    const [inputGlb, outputPng, w = '256', h = '256'] = args;
    await renderOne(page, inputGlb, outputPng, Number(w), Number(h), server);
  }

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
