const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

async function check() {
    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: 'qualiteberrygoodfarms@gmail.com',
            pass: 'gwokrlphyavrgqdo'
        },
        logger: false
    });

    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
        // Fetch UID 39 (the BULK email)
        const msg = await client.fetchOne('39', { source: true, uid: true });
        console.log('Got message UID 39, size:', msg.source.length);

        const parsed = await simpleParser(msg.source);
        console.log('Subject:', parsed.subject);
        console.log('From:', parsed.from?.text);
        console.log('Attachments count:', (parsed.attachments || []).length);

        (parsed.attachments || []).forEach((att, i) => {
            console.log(`  Attachment ${i}: filename="${att.filename}", contentType="${att.contentType}", size=${att.size}`);
            const isEml = (att.filename || '').toLowerCase().endsWith('.eml') || (att.contentType || '').includes('message/rfc822');
            console.log(`    isEml: ${isEml}`);
        });

        // Check if there are message/rfc822 parts in the raw MIME
        const rawStr = msg.source.toString().substring(0, 2000);
        console.log('\nFirst 2000 chars of raw MIME:');
        console.log(rawStr);
    } finally {
        lock.release();
    }
    await client.logout();
}

check().catch(e => console.error(e));
