/**
 * backupService.js — Sauvegarde quotidienne Firestore vers Cloud Storage + restauration.
 *
 * Exports:
 *   scheduledBackup  — pubsub.schedule: backup quotidien à minuit (Africa/Casablanca)
 *   backupApi        — https.onRequest: list / status / trigger / restore
 */

const functions = require("firebase-functions");
const { admin, db } = require("./config/firebase");
const { handleCors } = require("./middleware/cors");
const { requireAuth } = require("./middleware/requireAuth");

const BACKUP_PREFIX = "backups";
const RETENTION_DAYS = 7;
const EXCLUDED_PREFIXES = ["sql_mirror_", "replication_probe", "api_cache"];
const BATCH_READ_SIZE = 500;
const BATCH_WRITE_SIZE = 499;

function getBackupBucket() {
  return admin.storage().bucket("berrygood-farms-photos");
}

// ── Timestamp serialization ──────────────────────────────────────

function serializeValue(val) {
  if (val === null || val === undefined) return val;
  if (val instanceof admin.firestore.Timestamp) {
    return { _seconds: val.seconds, _nanoseconds: val.nanoseconds, __type: "Timestamp" };
  }
  if (val instanceof admin.firestore.GeoPoint) {
    return { latitude: val.latitude, longitude: val.longitude, __type: "GeoPoint" };
  }
  if (val instanceof admin.firestore.DocumentReference) {
    return { path: val.path, __type: "DocumentReference" };
  }
  if (val instanceof Buffer || val instanceof Uint8Array) {
    return { base64: Buffer.from(val).toString("base64"), __type: "Bytes" };
  }
  if (Array.isArray(val)) return val.map(serializeValue);
  if (typeof val === "object" && val.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = serializeValue(v);
    return out;
  }
  return val;
}

function deserializeValue(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(deserializeValue);
  if (typeof val === "object" && val !== null) {
    if (val.__type === "Timestamp") return new admin.firestore.Timestamp(val._seconds, val._nanoseconds);
    if (val.__type === "GeoPoint") return new admin.firestore.GeoPoint(val.latitude, val.longitude);
    if (val.__type === "DocumentReference") return db.doc(val.path);
    if (val.__type === "Bytes") return Buffer.from(val.base64, "base64");
    const out = {};
    for (const [k, v] of Object.entries(val)) out[k] = deserializeValue(v);
    return out;
  }
  return val;
}

// ── Collection discovery ─────────────────────────────────────────

async function getCollectionsToBackup() {
  const collections = await db.listCollections();
  return collections
    .map((c) => c.id)
    .filter((id) => !EXCLUDED_PREFIXES.some((p) => id.startsWith(p)));
}

// ── Backup one collection to GCS via streaming ───────────────────

async function backupCollection(bucket, dateStr, collectionName) {
  const filePath = `${BACKUP_PREFIX}/${dateStr}/${collectionName}.json`;
  const file = bucket.file(filePath);
  const stream = file.createWriteStream({ contentType: "application/json", resumable: false });

  return new Promise((resolve, reject) => {
    let docCount = 0;
    let sizeBytes = 0;
    let first = true;
    let lastDoc = null;
    let finished = false;

    const writeChunk = (str) => {
      sizeBytes += Buffer.byteLength(str);
      stream.write(str);
    };

    const processPages = async () => {
      writeChunk("[");
      while (true) {
        let query = db.collection(collectionName).orderBy("__name__").limit(BATCH_READ_SIZE);
        if (lastDoc) query = query.startAfter(lastDoc);
        const snap = await query.get();
        if (snap.empty) break;
        for (const doc of snap.docs) {
          const entry = JSON.stringify({ id: doc.id, data: serializeValue(doc.data()) });
          if (!first) writeChunk(",");
          writeChunk(entry);
          first = false;
          docCount++;
        }
        lastDoc = snap.docs[snap.docs.length - 1];
      }
      writeChunk("]");
      finished = true;
      stream.end();
    };

    stream.on("finish", () => {
      resolve({ name: collectionName, docCount, sizeBytes });
    });
    stream.on("error", (err) => {
      reject(err);
    });

    processPages().catch((err) => {
      if (!finished) stream.destroy(err);
      reject(err);
    });
  });
}

// ── Cleanup old backups ──────────────────────────────────────────

async function cleanupOldBackups(bucket) {
  const [files] = await bucket.getFiles({ prefix: `${BACKUP_PREFIX}/` });
  const folders = new Set();
  for (const f of files) {
    const parts = f.name.split("/");
    if (parts.length >= 2 && parts[1].match(/^\d{4}-\d{2}-\d{2}$/)) {
      folders.add(parts[1]);
    }
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  let deleted = 0;
  for (const folder of folders) {
    if (new Date(folder) < cutoff) {
      const [toDelete] = await bucket.getFiles({ prefix: `${BACKUP_PREFIX}/${folder}/` });
      await Promise.all(toDelete.map((f) => f.delete()));
      deleted += toDelete.length;
    }
  }
  return deleted;
}

// ── Restore one collection from GCS ──────────────────────────────

async function restoreCollection(bucket, dateStr, collectionName) {
  const filePath = `${BACKUP_PREFIX}/${dateStr}/${collectionName}.json`;
  const [contents] = await bucket.file(filePath).download();
  const docs = JSON.parse(contents.toString());

  let batch = db.batch();
  let count = 0;
  for (const { id, data } of docs) {
    const ref = db.collection(collectionName).doc(id);
    batch.set(ref, deserializeValue(data));
    count++;
    if (count % BATCH_WRITE_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % BATCH_WRITE_SIZE !== 0) await batch.commit();
  return count;
}

// ── Run full backup ──────────────────────────────────────────────

async function runBackup() {
  const bucket = getBackupBucket();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-CA", { timeZone: "Africa/Casablanca" });
  const startedAt = now.toISOString();

  const collectionNames = await getCollectionsToBackup();
  const results = [];

  // Process collections sequentially to avoid OOM
  for (const name of collectionNames) {
    try {
      const result = await backupCollection(bucket, dateStr, name);
      results.push(result);
      console.log(`[backup] ${name}: ${result.docCount} docs, ${result.sizeBytes} bytes`);
    } catch (err) {
      results.push({ name, docCount: 0, sizeBytes: 0, error: err.message });
      console.error(`[backup] ${name}: ERROR`, err.message);
    }
  }

  const completedAt = new Date().toISOString();
  const totalDocs = results.reduce((s, r) => s + r.docCount, 0);
  const totalSize = results.reduce((s, r) => s + r.sizeBytes, 0);
  const errors = results.filter((r) => r.error);

  const meta = {
    startedAt,
    completedAt,
    dateStr,
    collections: results,
    totalCollections: results.length,
    totalDocs,
    totalSizeBytes: totalSize,
    errors: errors.length,
    status: errors.length === 0 ? "success" : "partial",
  };

  // Save meta to GCS
  await bucket
    .file(`${BACKUP_PREFIX}/${dateStr}/_meta.json`)
    .save(JSON.stringify(meta), { contentType: "application/json" });

  // Update status in Firestore
  await db.collection("app_settings").doc("backup_status").set({
    lastBackupAt: admin.firestore.FieldValue.serverTimestamp(),
    lastDateStr: dateStr,
    totalCollections: results.length,
    totalDocs,
    totalSizeBytes: totalSize,
    status: meta.status,
    errors: errors.length,
  });

  // Cleanup old backups
  const deletedFiles = await cleanupOldBackups(bucket);
  meta.cleanedUpFiles = deletedFiles;

  return meta;
}

// ── List available backups ───────────────────────────────────────

async function listBackups() {
  const bucket = getBackupBucket();
  const [files] = await bucket.getFiles({ prefix: `${BACKUP_PREFIX}/` });

  const metaFiles = files.filter((f) => f.name.endsWith("/_meta.json"));
  const backups = [];

  for (const mf of metaFiles) {
    try {
      const [contents] = await mf.download();
      const meta = JSON.parse(contents.toString());
      backups.push({
        date: meta.dateStr,
        completedAt: meta.completedAt,
        totalCollections: meta.totalCollections,
        totalDocs: meta.totalDocs,
        totalSizeBytes: meta.totalSizeBytes,
        status: meta.status,
        collections: (meta.collections || []).map((c) => c.name),
      });
    } catch (e) {
      // skip corrupt meta
    }
  }

  backups.sort((a, b) => b.date.localeCompare(a.date));
  return backups;
}

// ═══════════════════════════════════════════════════════════════════
// Scheduled backup — every day at midnight Africa/Casablanca
// ═══════════════════════════════════════════════════════════════════

exports.scheduledBackup = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .pubsub.schedule("0 0 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    console.log("[scheduledBackup] Starting daily backup…");
    const result = await runBackup();
    console.log(`[scheduledBackup] Done: ${result.totalCollections} collections, ${result.totalDocs} docs, ${result.totalSizeBytes} bytes, ${result.errors} errors`);
    return null;
  });

// ═══════════════════════════════════════════════════════════════════
// HTTP API — admin-only backup management
// ═══════════════════════════════════════════════════════════════════

exports.backupApi = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .https.onRequest(async (req, res) => {
    if (handleCors(req, res)) return;

    const decoded = await requireAuth(req, res);
    if (!decoded) return;

    // Admin check
    const callerDoc = await db.collection("users").doc(decoded.uid).get();
    if (!callerDoc.exists || callerDoc.data().role !== "admin") {
      return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
    }

    const action = req.query.action || req.body?.action;

    try {
      if (action === "list") {
        const backups = await listBackups();
        return res.json({ success: true, backups });
      }

      if (action === "status") {
        const doc = await db.collection("app_settings").doc("backup_status").get();
        return res.json({ success: true, status: doc.exists ? doc.data() : null });
      }

      if (action === "trigger") {
        const result = await runBackup();
        return res.json({ success: true, result });
      }

      if (action === "restore") {
        const dateStr = req.query.date || req.body?.date;
        const collection = req.query.collection || req.body?.collection;

        if (!dateStr || !dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return res.status(400).json({ success: false, error: "Paramètre date requis (YYYY-MM-DD)" });
        }

        const bucket = getBackupBucket();

        if (collection) {
          const count = await restoreCollection(bucket, dateStr, collection);
          return res.json({ success: true, restored: [{ collection, docs: count }] });
        } else {
          const [files] = await bucket.getFiles({ prefix: `${BACKUP_PREFIX}/${dateStr}/` });
          const jsonFiles = files.filter((f) => f.name.endsWith(".json") && !f.name.endsWith("_meta.json"));
          const restored = [];
          for (const f of jsonFiles) {
            const name = f.name.split("/").pop().replace(".json", "");
            const count = await restoreCollection(bucket, dateStr, name);
            restored.push({ collection: name, docs: count });
          }
          return res.json({ success: true, restored });
        }
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("[backupApi]", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
