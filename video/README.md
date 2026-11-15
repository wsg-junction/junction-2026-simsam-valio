# Aimo showcase

`aimo-showcase.mp4` combines `opener.mp4`, `start.mp3`, and `body.mp3` with captured views of the local synthetic demo. Source media is preserved.

The edit uses 1080p output, full-screen app views with restrained movement, section labels, matched narration levels, and a closing card. It uses no additional music. App cuts follow the earlier script's section order; captions are editorial headings rather than a word-for-word transcript.

Working captures, timing data, and playback checks are under `work/`. The local recording instance uses separate data under `work/demo-data`; existing application data is not reset.

To reproduce from the repository root:

1. `node .recording/build-web.mjs` — build the recording UI from source, reusing the existing compiled stylesheet because the standard native build tools are restricted in this environment.
2. `node .recording/demo-server.mjs` — start the isolated demo on port 8791.
3. `node .recording/capture-showcase.cjs` — capture actual UI states and exercise quote, order, approval, and disruption flows. This resets only the isolated demo instance.
4. `node .recording/media-server.cjs` — serve the media locally on port 9346.
5. `node .recording/export-showcase.cjs` — render the MP4 in Chrome, approximately in real time.
6. `node .recording/verify-showcase.cjs` — verify dimensions, decodable audio, and selected frames.

The recording scripts require the isolated Playwright installation under `.recording/` and installed Google Chrome.
