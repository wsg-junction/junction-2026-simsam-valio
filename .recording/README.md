# Browser demo recording

Requires installed Google Chrome. Dependencies are isolated from the app in this folder.

Start the app from the repository root with `npm run dev`, then record:

```powershell
node .recording/record.cjs
node .recording/record.cjs http://localhost:5170/assistant/ 15 .recording/output/scene.webm
```

Arguments: URL, duration in seconds, output filename ending in `.webm`.
Output is a silent 1920 × 1080 WebM plus a PNG preview. Chrome encodes the video locally; no FFmpeg download is needed. The script checks that Chrome can decode the resulting video at the expected dimensions.

Add Playwright interactions using `page` in `record.cjs` to stage demo scenes. The current script records a static view. Capture cadence depends on rendering performance; this is suitable for UI walkthroughs, not guaranteed high-frame-rate animation. Audio editing and MP4 conversion require a separate encoder.

To reinstall dependencies: `npm install --prefix .recording playwright`.
Generated clips and browser dependencies are local artifacts and should not be committed.
