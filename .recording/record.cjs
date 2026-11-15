const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');

// Chrome's built-in WebM encoder avoids downloading an additional FFmpeg binary.
async function main() {
  const url = process.argv[2] || 'http://localhost:5170/assistant/';
  const seconds = Number(process.argv[3] || 8);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Duration must be positive.');
  const output = path.resolve(process.argv[4] || '.recording/output/assistant-preview.webm');
  await fs.mkdir(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const encoder = await context.newPage();
    await encoder.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1920; canvas.height = 1080;
      document.body.append(canvas);
      window.ctx = canvas.getContext('2d');
      window.parts = [];
      window.recorder = new MediaRecorder(canvas.captureStream(30), {
        mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000,
      });
      window.recorder.ondataavailable = e => { if (e.data.size) window.parts.push(e.data); };
    });
    async function frame() {
      const data = (await page.screenshot({ type: 'jpeg', quality: 90 })).toString('base64');
      await encoder.evaluate(async data => {
        const blob = await (await fetch('data:image/jpeg;base64,' + data)).blob();
        const bitmap = await createImageBitmap(blob);
        window.ctx.drawImage(bitmap, 0, 0); bitmap.close();
      }, data);
    }
    await frame();
    await encoder.evaluate(() => window.recorder.start());
    const start = Date.now();
    // Add scripted interactions with `page` here for each demo scene.
    let frames = 0;
    while (Date.now() - start < seconds * 1000) {
      await frame(); frames++;
      await new Promise(resolve => setTimeout(resolve, 65));
    }
    const data = await encoder.evaluate(() => new Promise(resolve => {
      window.recorder.onstop = async () => {
        const blob = new Blob(window.parts, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      };
      window.recorder.stop();
    }));
    await fs.writeFile(output, Buffer.from(data, 'base64'));
    const dimensions = await encoder.evaluate(data => new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.onloadeddata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => reject(new Error('Recorded video could not be decoded.'));
      video.src = 'data:video/webm;base64,' + data;
    }), data);
    await page.screenshot({ path: output.replace(/\.webm$/i, '') + '.png' });
    console.log(JSON.stringify({ output, bytes: (await fs.stat(output)).size, frames, ...dimensions, title: await page.title() }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
