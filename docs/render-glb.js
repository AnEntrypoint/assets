const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

// node render-glb.js <in.glb> <out.png> [w] [h]
//
// One browser + one model per invocation (proven reliable under CI's
// swiftshader/angle headless setup). Serves model-viewer from a local
// vendored copy (docs/lib/model-viewer.min.js) instead of the CDN so each
// invocation isn't paying a fresh network fetch + module registration.

const [, , inputGlb, outputPng, w = '256', h = '256'] = process.argv;
const width = Number(w), height = Number(h);
const glbPath = path.resolve(inputGlb);
const glbBytes = fs.readFileSync(glbPath);
const mvScriptPath = path.resolve(__dirname, 'lib/model-viewer.min.js');
const mvScript = fs.readFileSync(mvScriptPath);
const meshoptScriptPath = path.resolve(__dirname, 'lib/meshopt_decoder.js');
const meshoptScript = fs.readFileSync(meshoptScriptPath);

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/model.glb') {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Access-Control-Allow-Origin': '*' });
      res.end(glbBytes);
    } else if (req.url === '/model-viewer.min.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(mvScript);
    } else if (req.url === '/meshopt_decoder.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(meshoptScript);
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl',
    ],
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.setContent(`<!DOCTYPE html><html><head>
<style>*{margin:0;padding:0;background:#1a1a1a}body{width:${width}px;height:${height}px;overflow:hidden}</style>
<script type="module" src="http://127.0.0.1:${port}/model-viewer.min.js"></script>
</head><body>
<model-viewer id="mv"
  style="width:${width}px;height:${height}px;background-color:#1a1a1a"
  shadow-intensity="1" exposure="1.2" tone-mapping="commerce">
</model-viewer>
</body></html>`);

  await page.evaluate(async (port) => {
    await customElements.whenDefined('model-viewer');
    customElements.get('model-viewer').setMeshoptDecoderLocation(`http://127.0.0.1:${port}/meshopt_decoder.js`);
    document.querySelector('#mv').src = `http://127.0.0.1:${port}/model.glb`;
  }, port);

  await page.waitForFunction(() => {
    const mv = document.querySelector('#mv');
    return mv && mv.loaded;
  }, { timeout: 15000 }).catch(() => {});

  await page.waitForTimeout(400);
  await page.screenshot({ path: outputPng });
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
