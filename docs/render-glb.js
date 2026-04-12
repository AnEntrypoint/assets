const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

const [,, inputGlb, outputPng, w = '256', h = '256'] = process.argv;
const width = Number(w), height = Number(h);
const glbPath = path.resolve(inputGlb);
const glbBytes = fs.readFileSync(glbPath);

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/model.glb') {
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Access-Control-Allow-Origin': '*' });
      res.end(glbBytes);
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
<script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js"></script>
</head><body>
<model-viewer id="mv" src="http://127.0.0.1:${port}/model.glb"
  style="width:${width}px;height:${height}px;background-color:#1a1a1a"
  shadow-intensity="1" exposure="1.2" tone-mapping="commerce">
</model-viewer>
</body></html>`);

  await page.waitForFunction(() => {
    const mv = document.querySelector('#mv');
    return mv && mv.loaded;
  }, { timeout: 30000 }).catch(() => {});

  await page.waitForTimeout(1500);
  await page.screenshot({ path: outputPng });
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
