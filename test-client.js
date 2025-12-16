const WebSocket = require('ws');

// Connect first client
const client1 = new WebSocket('ws://localhost:4000');
let client1Id;

// Connect second client
const client2 = new WebSocket('ws://localhost:4000');
let client2Id;

const infoHash = 'test-file-hash';

client1.on('open', () => {
    console.log('Client 1 Connected');
});

client1.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Client 1 received:', msg.type);
    
    if (msg.type === 'welcome') {
        client1Id = msg.peerId;
        console.log('Client 1 ID:', client1Id);
        // Announce a file
        client1.send(JSON.stringify({ type: 'announce', infoHash }));
    }
    
    if (msg.type === 'signal') {
        console.log('Client 1 received signal from:', msg.from, 'Data:', msg.signal);
    }
});

client2.on('open', () => {
    console.log('Client 2 Connected');
});

client2.on('message', (data) => {
    const msg = JSON.parse(data);
    console.log('Client 2 received:', msg.type);

    if (msg.type === 'welcome') {
        client2Id = msg.peerId;
        console.log('Client 2 ID:', client2Id);
        
        // Give Client 1 a moment to announce, then lookup
        setTimeout(() => {
            console.log('Client 2 Looking up file...');
            client2.send(JSON.stringify({ type: 'lookup', infoHash }));
        }, 1000);
    }

    if (msg.type === 'peers') {
        console.log('Client 2 received peers list:', msg.peers);
        if (msg.peers.includes(client1Id)) {
            console.log('SUCCESS: Client 2 found Client 1!');
            
            // Send signal to Client 1
            client2.send(JSON.stringify({
                type: 'signal',
                to: client1Id,
                signal: { sdp: 'fake-sdp-offer' }
            }));
        } else {
            console.log('FAILURE: Client 1 not found in list');
        }
    }
});

// Close after 5 seconds
setTimeout(() => {
    console.log('Closing clients...');
    client1.close();
    client2.close();
}, 5000);
