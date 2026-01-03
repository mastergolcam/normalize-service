import express from "express";
import fs from "fs";
import { execFile } from "child_process";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

/**
 * POST /normalize
 * Body:
 * {
 *   "download_url": "https://...signed...",
 *   "upload_url": "https://...signed...",
 *   "fps": 60,          // opcional
 *   "crf": 18           // opcional
 * }
 */
app.post("/normalize", async (req, res) => {
  try {
    const { download_url, upload_url, fps, crf } = req.body || {};

    if (!download_url) return res.status(400).json({ error: "download_url is required" });
    if (!upload_url) return res.status(400).json({ error: "upload_url is required" });

    const outFps = Number.isFinite(Number(fps)) ? String(fps) : "60";
    const outCrf = Number.isFinite(Number(crf)) ? String(crf) : "18";

    const inFile = `/tmp/in_${Date.now()}.webm`;
    const outFile = `/tmp/out_${Date.now()}.mp4`;

    // 1) Download WebM (signed URL)
    const r = await fetch(download_url);
    if (!r.ok) throw new Error(`Failed to download: ${r.status} ${r.statusText}`);
    fs.writeFileSync(inFile, Buffer.from(await r.arrayBuffer()));

    // 2) Convert to MP4 (H.264 + AAC, CFR)
    await run("ffmpeg", [
      "-y",
      "-i", inFile,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-vf", `fps=${outFps}`,
      "-vsync", "cfr",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", outCrf,
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-ar", "48000",
      outFile
    ]);

    // 3) Upload MP4 using signed upload URL (PUT)
    const mp4 = fs.readFileSync(outFile);

    const up = await fetch(upload_url, {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-length": String(mp4.length),
      },
      body: mp4,
    });

    if (!up.ok) {
      const txt = await up.text().catch(() => "");
      throw new Error(`Upload failed: ${up.status} ${up.statusText} ${txt}`);
    }

    // cleanup
    try { fs.unlinkSync(inFile); } catch {}
    try { fs.unlinkSync(outFile); } catch {}

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Normalize service running");
});