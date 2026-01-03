import express from "express";
import fs from "fs";
import { execFile } from "child_process";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "normalized";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars");
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

app.post("/normalize", async (req, res) => {
  try {
    const { source_url, dest_path } = req.body || {};
    if (!source_url) {
      return res.status(400).json({ error: "source_url is required" });
    }

    const inFile = `/tmp/in_${Date.now()}.webm`;
    const outFile = `/tmp/out_${Date.now()}.mp4`;

    const r = await fetch(source_url);
    if (!r.ok) throw new Error("Failed to download source_url");
    fs.writeFileSync(inFile, Buffer.from(await r.arrayBuffer()));

    await run("ffmpeg", [
      "-y",
      "-i", inFile,
      "-map", "0:v:0",
      "-map", "0:a?",
      "-vf", "fps=60",
      "-vsync", "cfr",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-profile:v", "high",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-ar", "48000",
      outFile
    ]);

    const key = dest_path || `highlights/${Date.now()}.mp4`;
    const mp4 = fs.readFileSync(outFile);

    const { error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .upload(key, mp4, {
        contentType: "video/mp4",
        upsert: true
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from(SUPABASE_BUCKET)
      .getPublicUrl(key);

    try { fs.unlinkSync(inFile); } catch {}
    try { fs.unlinkSync(outFile); } catch {}

    return res.json({
      normalized_url: data.publicUrl
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Normalize service running");
});