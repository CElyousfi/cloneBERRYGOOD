// Grab an OLDER liquidation PDF (from bulk .eml wrappers) to compare locale format
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { PDFParse } = require("pdf-parse");

async function main() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: process.env.IMAP_TLS !== "false",
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });
  await client.connect();
  await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

  // Find bulk .eml wrappers
  const results = await client.search({ subject: "LIQUIDATION" });
  const wanted = process.argv[2] || "WEEK 43-2025"; // target an old week

  for (const uid of results) {
    let msg = null;
    for await (const m of client.fetch([uid], { uid: true, source: true })) { msg = m; break; }
    if (!msg) continue;
    const parsed = await simpleParser(msg.source);
    const emls = (parsed.attachments || []).filter(
      (a) => (a.filename || "").toLowerCase().endsWith(".eml") || (a.contentType || "").includes("message/rfc822")
    );
    for (const eml of emls) {
      const inner = await simpleParser(eml.content);
      const subj = inner.subject || "";
      if (!subj.includes(wanted)) continue;
      console.log(`Found inner: "${subj}"`);
      const pdf = (inner.attachments || []).find(
        (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
      );
      if (!pdf) {
        console.log("  no LIQUIDATION pdf");
        continue;
      }
      const safe = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      fs.writeFileSync(`/tmp/liq-diag/${safe}`, pdf.content);
      const p = new PDFParse({ data: pdf.content });
      const r = await p.getText();
      fs.writeFileSync(`/tmp/liq-diag/${safe}.txt`, r.text || "");
      console.log(`  saved ${safe} (${pdf.size} bytes)`);
      await client.logout();
      process.exit(0);
    }
  }
  await client.logout();
  console.log("Not found");
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
