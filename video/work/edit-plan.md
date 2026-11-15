# Aimo showcase edit

## Source media

| File | Duration | Format |
| --- | --- | --- |
| `../opener.mp4` | 10.042 seconds | 1280 × 720 video |
| `../start.mp3` | 57.920 seconds | Narration audio |
| `../body.mp3` | 16.880 seconds | Narration audio |

Original media is preserved. Mono 16 kHz WAV working copies and audio analysis JSON files are in this folder. Simple edge-level detection did not identify removable leading or trailing silence; further cuts require listening or a transcript.

## Assembly direction

1. Preserve the opening joke and its pauses. Inspect the opener's existing audio before overlaying narration.
2. Use narration text to identify the handoff from the opening into the product introduction; filenames alone do not establish the correct ordering.
3. Capture the introduction, milk request and product results, requirements, spending limits, approval flow, and audit trail as supported by the spoken lines.
4. Prefer readable full-screen app footage, with cuts on narration changes. Avoid inventing product results or approval outcomes.
5. End with a brief Aimo title card. Export at 1920 × 1080; preserve the opener's aspect ratio when scaling.

## Capture and export

The requested deployment was inaccessible from the recording browser. The user authorized local capture, using the earlier script. Captures use an isolated synthetic demo instance on port 8791.

The finished `../aimo-showcase.mp4` is approximately 88 seconds at 1920 × 1080 with stereo audio. It preserves the opener and both narration tracks, uses app screenshots with restrained movement and section labels, and ends on a closing card. Narration levels were matched; silence analysis found no pauses longer than the conservative trimming threshold, so no speech was removed. Cuts follow script sections rather than a word-timed transcript. See `export-report.json` and `verification.json` for export and playback checks.
