const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// HTTP Health Check
app.get('/', (req, res) => {
    res.send({ status: 'active', peers: wss.clients.size });
});

/**
 * Data Structures
 * files: Map<InfoHash, Set<PeerId>>
 * peerSockets: Map<PeerId, WebSocket>
 */
const files = new Map();
const peerSockets = new Map();

wss.on('connection', (ws) => {
    // Assign a temporary ID until they identify themselves, or persist this.
    // Ideally, the client sends us their PeerID, or we generate one.
    // For this implementation, we'll assign one if not provided, 
    // but the handshake is cleaner if we just consider this socket "anonymous" 
    // until it sends an 'announce' or 'identify' message.
    
    ws.id = uuidv4();
    ws.isAlive = true; // Heartbeat init
    ws.on('pong', () => { ws.isAlive = true; }); // Heartbeat response

    peerSockets.set(ws.id, ws);

    console.log(`Peer connected: ${ws.id}`);

    ws.send(JSON.stringify({ type: 'welcome', peerId: ws.id }));

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Failed to parse message', e);
        }
    });

    ws.on('close', () => {
        console.log(`Peer disconnected: ${ws.id}`);
        cleanupPeer(ws.id);
    });
});

function handleMessage(ws, data) {
    switch (data.type) {
        case 'announce':
            // Client says: "I have this file"
            // Payload: { infoHash: string }
            if (data.infoHash) {
                if (!files.has(data.infoHash)) {
                    files.set(data.infoHash, new Set());
                }
                files.get(data.infoHash).add(ws.id);
                console.log(`Peer ${ws.id} announced ${data.infoHash}`);
            }
            break;

        case 'lookup':
            // Client asks: "Who has this file?"
            // Payload: { infoHash: string }
            // Response: { type: 'peers', infoHash: string, peers: [PeerId] }
            if (data.infoHash) {
                const swarm = files.get(data.infoHash);
                const activePeers = [];
                
                if (swarm) {
                    swarm.forEach(peerId => {
                        // Don't send back the requester's own ID
                        if (peerId !== ws.id && peerSockets.has(peerId)) {
                            activePeers.push(peerId);
                        }
                    });
                }
                
                ws.send(JSON.stringify({
                    type: 'peers',
                    infoHash: data.infoHash,
                    peers: activePeers
                }));
            }
            break;

        case 'signal':
            // Client wants to send WebRTC signal to another peer
            // Payload: { to: TargetPeerId, signal: any }
            if (data.to && data.signal) {
                const targetSocket = peerSockets.get(data.to);
                if (targetSocket && targetSocket.readyState === WebSocket.OPEN) {
                    targetSocket.send(JSON.stringify({
                        type: 'signal',
                        from: ws.id,
                        signal: data.signal
                    }));
                } else {
                    console.warn(`Signal failed: Target ${data.to} not found or offline`);
                }
            }
            break;

        default:
            console.warn('Unknown message type:', data.type);
    }
}

function cleanupPeer(peerId) {
    // Remove from socket map
    peerSockets.delete(peerId);

    // Remove from all file swarms
    for (const [infoHash, swarm] of files.entries()) {
        if (swarm.has(peerId)) {
            swarm.delete(peerId);
            if (swarm.size === 0) {
                files.delete(infoHash);
            }
        }
    }
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`Tracker server running on port ${PORT}`);
});

// Heartbeat to keep connections alive (Render/Nginx timeouts)
const interval = setInterval(function ping() {
    wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', function close() {
    clearInterval(interval);
});
