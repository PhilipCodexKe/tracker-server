const WebSocket = require('ws');

// URL of the deployed tracker
const TRACKER_URL = 'wss://tracker-server-uwzg.onrender.com/';
const TEST_INFO_HASH = 'test-info-hash-12345';

console.log(`Connecting to ${TRACKER_URL}...`);

function createClient(name, shouldAnnounce = false) {
    const ws = new WebSocket(TRACKER_URL);
    
    ws.on('open', () => {
        console.log(`[${name}] Connected`);
    });

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log(`[${name}] Received:`, msg);

            if (msg.type === 'welcome') {
                const myPeerId = msg.peerId;
                console.log(`[${name}] Assigned ID: ${myPeerId}`);

                if (shouldAnnounce) {
                    console.log(`[${name}] Announcing file...`);
                    ws.send(JSON.stringify({
                        type: 'announce',
                        infoHash: TEST_INFO_HASH
                    }));
                } else {
                    // Wait a bit for the other peer to announce, then lookup
                    setTimeout(() => {
                        console.log(`[${name}] Looking up peers...`);
                        ws.send(JSON.stringify({
                            type: 'lookup',
                            infoHash: TEST_INFO_HASH
                        }));
                    }, 2000);
                }
            }
        } catch (e) {
            console.error(`[${name}] Error parsing message:`, e);
        }
    });

    ws.on('error', (err) => {
        console.error(`[${name}] Error:`, err.message);
    });

    ws.on('close', () => {
        console.log(`[${name}] Disonnected`);
    });
    
    return ws;
}

// Simulate Peer A (Seeder/Announcer)
const peerA = createClient('Peer A', true);

// Simulate Peer B (Leecher/Lookup)
// Peer B connects closely after Peer A to ensure A has time to register
setTimeout(() => {
    const peerB = createClient('Peer B', false);
}, 1000);

// Keep alive for a bit then exit
setTimeout(() => {
    console.log('Test complete, closing connections...');
    process.exit(0);
}, 10000);
