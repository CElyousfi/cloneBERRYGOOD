const { ImapFlow } = require('imapflow');

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
        console.log('Mailbox status:', client.mailbox.exists, 'messages');

        // Get last 5 messages
        const msgs = [];
        for await (const msg of client.fetch(
            client.mailbox.exists > 5 ? `${client.mailbox.exists - 4}:*` : '1:*',
            { envelope: true, uid: true, bodyStructure: true }
        )) {
            msgs.push({
                uid: msg.uid,
                from: msg.envelope.from ? msg.envelope.from.map(f => f.address).join(', ') : '',
                subject: msg.envelope.subject,
                date: msg.envelope.date,
                hasAttachments: msg.bodyStructure && msg.bodyStructure.childNodes ? msg.bodyStructure.childNodes.length : 0
            });
        }

        console.log('\nLast 5 messages:');
        msgs.forEach(m => {
            console.log(`  UID ${m.uid} | ${m.date} | From: ${m.from}`);
            console.log(`    Subject: ${m.subject}`);
            console.log(`    Parts: ${m.hasAttachments}`);
        });
    } finally {
        lock.release();
    }
    await client.logout();
}

check().catch(e => console.error(e));
