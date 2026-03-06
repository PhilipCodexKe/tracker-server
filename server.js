const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files with absolute path

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Explicitly serve index.html for root route to avoid 404s
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * Data Structures
 * files: Map<InfoHash, Set<PeerId>>
 * peerSockets: Map<PeerId, WebSocket>
 * peerInfo: Map<PeerId, { name: string, ip: string, ips: Object }>
 */
const files = new Map();
const peerSockets = new Map();
const peerInfo = new Map();
const rooms = new Map(); // [NEW] roomKey -> Set<PeerId>

function getAvailableAnonymousName() {
    const usedIndices = new Set();
    
    // Check all active peers in rooms
    peerInfo.forEach(info => {
        const match = info.name && info.name.match(/^Anonymous (\d+)$/);
        if (match) usedIndices.add(parseInt(match[1]));
    });

    // Check sockets that are registered but haven't 'joined' a room yet
    peerSockets.forEach(ws => {
        if (ws.defaultName) {
            const match = ws.defaultName.match(/^Anonymous (\d+)$/);
            if (match) usedIndices.add(parseInt(match[1]));
        }
    });

    let i = 1;
    while (usedIndices.has(i)) i++;
    return `Anonymous ${i}`;
}



function normalizeIp(ip) {
    if (!ip) return '127.0.0.1';
    ip = ip.trim();
    if (ip === '::1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) return ip.substring(7);
    return ip;
}


wss.on('connection', (ws, req) => {
    // 1. Initial Handshake - Wait for IP
    ws.isAlive = true; 
    ws.ipInfo = { local: null, public: null }; // [NEW] Initialize IP storage
    ws.on('pong', () => { ws.isAlive = true; }); 

    // Send greeting immediately so client knows we are connected
    ws.send(JSON.stringify({ type: 'greeting', message: "Hello welcome I'm the tracker" }));

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] Socket connected (Waiting for IP...)`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('Failed to parse message', e);
        }
    });

    ws.on('close', () => {
        if (ws.id) { // Only clean up if fully registered
            console.log(`Peer disconnected: ${ws.id}`);
            // Capture info before cleanup for broadcast
            const info = peerInfo.get(ws.id);
            const name = info ? info.name : 'Unknown';
    
            cleanupPeer(ws.id);
            
            // Broadcast disconnect
            broadcast({ 
                type: 'peer-left', 
                peerId: ws.id,
                name: name
            });
        } else {
             console.log(`[${new Date().toLocaleTimeString()}] Unregistered socket disconnected`);
        }
    });
});

function broadcast(data, excludePeerId = null, roomKey = null) {
    if (!roomKey) return; // Disallow global broadcast for room-based tracker

    const roomPeers = rooms.get(roomKey);
    if (!roomPeers) return;

    roomPeers.forEach(peerId => {
        if (peerId !== excludePeerId) {
            const client = peerSockets.get(peerId);
            if (client && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        }
    });
}

// Helper to register a new peer once IP is received
function registerNewPeer(ws, ipData) {
    // ipData can be existing simple string or new { local, public } object
    let primaryIp = null;
    let ips = { local: null, public: null };

    if (typeof ipData === 'string') {
        primaryIp = normalizeIp(ipData);
        ips.public = primaryIp; // Assume string is public-ish
    } else if (ipData && typeof ipData === 'object') {
        ips = ipData;
        primaryIp = normalizeIp(ipData.public || ipData.local); // Prefer public
    }

    if (!primaryIp) primaryIp = '127.0.0.1'; // Fallback

    // Update socket storage
    ws.ipInfo = ips;

    // 1. Generate ID
    const ipNum = 1n; 
    
    const r1 = Math.floor(Math.random() * 1000000000);
    const r2 = Math.floor(Math.random() * 1000000000);
    const randomBase = BigInt(r1) * BigInt(r2);
    
    const generatedIdVal = randomBase * ipNum;
    const newPeerId = generatedIdVal.toString(16).padStart(16, '0').slice(-16).toUpperCase(); 

    ws.id = newPeerId;

    // 2. Assign Default Name (Reuse index if available)
    ws.defaultName = getAvailableAnonymousName();
    
    // 3. Store
    peerSockets.set(ws.id, ws);
}

function sendLog(peerId, message, level = 'info') {
    const ws = peerSockets.get(peerId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'connection-log', message, level }));
    }
}

function finalizeRegistration(ws, roomKey, name, ips) {
    const peerId = ws.id;
    if (!peerId) return;

    const primaryIp = normalizeIp(ips.public || ips.local || '127.0.0.1');
    
    // Store Peer Info
    peerInfo.set(peerId, { 
        name: name, 
        ip: primaryIp,
        ips: ips,
        roomKey: roomKey
    });

    // Add to Room
    if (!rooms.has(roomKey)) {
        rooms.set(roomKey, new Set());
    }
    const roomPeersSet = rooms.get(roomKey);
    const isHost = roomPeersSet.size === 0;
    roomPeersSet.add(peerId);
    ws.roomKey = roomKey;

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] Peer ${peerId} joined room: ${roomKey} as ${isHost ? 'HOST' : 'GUEST'}`);

    // Notify Peer of their role
    ws.send(JSON.stringify({ 
        type: 'welcome', 
        peerId: peerId,
        name: name,
        ip: primaryIp,
        ips: ips,
        roomKey: roomKey,
        role: isHost ? 'host' : 'guest'
    }));

    sendLog(peerId, `SYSTEM_READY: Joined room ${roomKey} as ${isHost ? 'HOST' : 'GUEST'}.`, 'success');

    if (!isHost) {
         // Notify existing peers that a new guest is here
         // The guest will initiate handshakes upon receiving the snapshot
         broadcast({ 
            type: 'peer-joined', 
            peerId: peerId,
            name: name,
            ip: primaryIp,
            ips: ips
        }, peerId, roomKey);
    }

    // Send Peers List Snapshot (ROOM ONLY)
    const roomPeers = [];
    roomPeersSet.forEach(id => {
        if (id !== peerId) {
            const info = peerInfo.get(id);
            if (info) {
                roomPeers.push({
                    peerId: id,
                    name: info.name,
                    ip: info.ip,
                    ips: info.ips
                });
            }
        }
    });
    ws.send(JSON.stringify({ type: 'peer-list-snapshot', peers: roomPeers }));
}

function handleMessage(ws, data) {
    switch (data.type) {
        case 'join-room':
            // New preferred registration method
            // Payload: { roomKey, name, ips }
            if (data.roomKey) {
                if (!ws.id) {
                    registerNewPeer(ws, data.ips || {});
                }
                finalizeRegistration(ws, data.roomKey, data.name || ws.defaultName, data.ips || {});
            }
            break;

        case 'register':
            // Legacy support
            if (data.ip && !ws.id) {
                registerNewPeer(ws, data.ip);
            }
            break;

        case 'identify':
            if (data.ips) {
                ws.ipInfo = data.ips;
                if (!ws.id) {
                    registerNewPeer(ws, data.ips);
                } else if (ws.roomKey) {
                    const info = peerInfo.get(ws.id);
                    if (info) {
                        info.ips = data.ips;
                        if (data.ips.public) info.ip = normalizeIp(data.ips.public);
                        peerInfo.set(ws.id, info);
                        broadcast({
                            type: 'peer-updated',
                            peerId: ws.id,
                            name: info.name,
                            ip: info.ip,
                            ips: info.ips
                        }, ws.id, ws.roomKey);
                    }
                }
            }

            if (data.name && ws.id && ws.roomKey) {
                const info = peerInfo.get(ws.id);
                if (info) {
                    info.name = data.name;
                    peerInfo.set(ws.id, info);
                    broadcast({
                        type: 'peer-updated',
                        peerId: ws.id,
                        name: info.name,
                        ip: info.ip,
                        ips: info.ips
                    }, ws.id, ws.roomKey);
                    ws.send(JSON.stringify({ type: 'identity-confirmed', name: info.name, ip: info.ip }));
                }
            }
            break;
            break;

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
                        if (peerId !== ws.id && peerSockets.has(peerId)) {
                             const info = peerInfo.get(peerId);
                             // ONLY return peers in the same room
                             if (info && info.roomKey === ws.roomKey) {
                                activePeers.push({
                                    peerId: peerId,
                                    ips: info.ips,
                                    ip: info.ip
                                });
                             }
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

        case 'chat':
            // Client sending a public chat message (Standard Tracker Client)
            if (data.message) {
                const info = peerInfo.get(ws.id);
                const senderName = info ? info.name : 'Unknown';
                
                console.log(`[CHAT] ${senderName}: ${data.message}`);
                
                broadcast({
                    type: 'chat',
                    message: data.message,
                    from: senderName,
                    peerId: ws.id
                }, ws.id, ws.roomKey); 
            }
            break;

        case 'chat-message':
            // Client sending a chat message (From APK/P2PServer)
            // Payload is likely an object from ChatHandler
            if (data.payload) {
                const info = peerInfo.get(ws.id);
                const senderName = info ? info.name : 'Unknown';
                
                // Extract text from payload (handle common structures)
                let text = data.payload.text || data.payload.message || data.payload.content;
                if (!text && typeof data.payload === 'string') text = data.payload;

                if (text) {
                    console.log(`[CHAT-APK] ${senderName}: ${text}`);
                    
                    broadcast({
                        type: 'chat',
                        message: text,
                        from: senderName,
                        peerId: ws.id
                    }, ws.id, ws.roomKey);
                }
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

                    // Log signaling progress
                    sendLog(ws.id, `SIGNAL_RELAY: Sent signal to ${data.to}`, 'info');
                    sendLog(data.to, `SIGNAL_INCOMING: Received signal from ${ws.id}`, 'info');
                } else {
                    console.warn(`Signal failed: Target ${data.to} not found or offline`);
                    sendLog(ws.id, `SIGNAL_ERROR: Target ${data.to} is offline.`, 'error');
                }
            }
            break;

        default:
            console.warn('Unknown message type:', data.type);
    }
}

function cleanupPeer(peerId) {
    const info = peerInfo.get(peerId);
    if (info && info.roomKey) {
        const roomPeers = rooms.get(info.roomKey);
        if (roomPeers) {
            roomPeers.delete(peerId);
            if (roomPeers.size === 0) {
                rooms.delete(info.roomKey);
            }
        }
    }

    peerSockets.delete(peerId);
    peerInfo.delete(peerId);

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
