const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Single-file mode (back-compat):  node render-glb.js <in.glb> <out.png> [w] [h]
// Batch mode:                      node render-glb.js --batch <pairs.json> [w] [h]
//   pairs.json = [[inputGlb, outputPng], ...]
// Batch mode launches ONE browser, loads model-viewer ONCE, and reuses the
// same <model-viewer> element across all models (swapping .src + waiting for
// the 'load' event) instead of re-navigating/re-injecting the CDN script per
// model -- that per-model page.setContent() was re-fetching+re-registering
// the custom element every time, dominating render time (~30s/model).

const args = process.argv.slice(2);
const batchMode = args[0] === '--batch';

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

async function preparePage(browser, width, height, server) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(`<!DOCTYPE html><html><head>
<style>*{margin:0;padding:0;background:#1a1a1a}body{width:${width}px;height:${height}px;overflow:hidden}</style>
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js"></script>
</head><body>
<model-viewer id="mv"
  style="width:${width}px;height:${height}px;background-color:#1a1a1a"
  shadow-intensity="1" exposure="1.2" tone-mapping="commerce">
</model-viewer>
</body></html>`);
  await page.waitForFunction(() => customElements.get('model-viewer') !== undefined, { timeout: 30000 });
  return page;
}

async function renderOne(page, glbPath, outputPng, server) {
  server.currentBytes = fs.readFileSync(path.resolve(glbPath));
  const src = `http://127.0.0.1:${server.port}/model.glb?t=${Date.now()}`;
  await page.evaluate((s) => {
    const mv = document.querySelector('#mv');
    mv.loaded = false;
    mv.src = s;
  }, src);
  await page.waitForFunction(() => document.querySelector('#mv').loaded, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  fs.mkdirSync(path.dirname(outputPng), { recursive: true });
  await page.screenshot({ path: outputPng });
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

  if (batchMode) {
    const pairs = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const width = Number(args[2] || '256'), height = Number(args[3] || '256');
    const page = await preparePage(browser, width, height, server);
    let ok = 0, failed = 0;
    for (const [inputGlb, outputPng] of pairs) {
      try {
        await renderOne(page, inputGlb, outputPng, server);
        ok++;
      } catch (e) {
        console.error(`WARN: failed ${inputGlb}: ${e.message}`);
        failed++;
      }
      if ((ok + failed) % 25 === 0) console.log(`[render-glb] progress: ${ok + failed}/${pairs.length}`);
    }
    console.log(`[render-glb] ${ok} rendered, ${failed} failed`);
  } else {
    const [inputGlb, outputPng, w = '256', h = '256'] = args;
    const page = await preparePage(browser, Number(w), Number(h), server);
    await renderOne(page, inputGlb, outputPng, server);
  }

  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
