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
 * peerInfo: Map<PeerId, { name: string, ip: string }>
 */
const files = new Map();
const peerSockets = new Map();
const peerInfo = new Map();

let anonymousCounter = 1;



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

function broadcast(data, excludePeerId = null) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.id && client.id !== excludePeerId) {
            client.send(JSON.stringify(data));
        }
    });
}

// Helper to register a new peer once IP is received
function registerNewPeer(ws, ipAddress) {
    const ip = normalizeIp(ipAddress);
    
    // 1. Generate ID
    // IP Number - Default to 1 if null (though we expect an IP now)
    const ipNum = 1n; 
    
    const r1 = Math.floor(Math.random() * 1000000000);
    const r2 = Math.floor(Math.random() * 1000000000);
    const randomBase = BigInt(r1) * BigInt(r2);
    
    const generatedIdVal = randomBase * ipNum;
    const newPeerId = generatedIdVal.toString(16).padStart(16, '0').slice(-16).toUpperCase(); 

    ws.id = newPeerId;

    // 2. Generate Name
    const defaultName = `Anonymous ${anonymousCounter++}`;
    
    // 3. Store
    peerSockets.set(ws.id, ws);
    peerInfo.set(ws.id, { name: defaultName, ip: ip });

    const time = new Date().toLocaleTimeString();
    console.log(`[${time}] Peer Registered: ${ws.id} (IP: ${ip})`);
    
    // 4. Broadcast to others
    broadcast({ 
        type: 'peer-joined', 
        peerId: ws.id,
        name: defaultName,
        ip: ip
    }, ws.id);

    // 5. Send Welcome & Info to Client
    ws.send(JSON.stringify({ 
        type: 'welcome', 
        peerId: ws.id,
        name: defaultName,
        ip: ip
    }));
    
    ws.send(JSON.stringify({
        type: 'your-info',
        name: defaultName,
        peerId: ws.id,
        ip: ip
    }));
    
    ws.send(JSON.stringify({ 
        type: 'registered', 
        ip: ip,
        peerId: ws.id,
        name: defaultName
    }));

    // 6. Send Peers List Snapshot
    const existingPeers = [];
    peerSockets.forEach((socket, id) => {
        if (id !== ws.id && socket.readyState === WebSocket.OPEN) {
            const info = peerInfo.get(id);
            existingPeers.push({
                peerId: id,
                name: info ? info.name : 'Unknown',
                ip: info ? info.ip : 'Unknown'
            });
        }
    });
    ws.send(JSON.stringify({ type: 'peer-list-snapshot', peers: existingPeers }));
}

function handleMessage(ws, data) {
    switch (data.type) {
        case 'register':
            // Client registering with specific IP
            if (data.ip) {
                if (!ws.id) {
                     // First time registration
                     registerNewPeer(ws, data.ip);
                } else {
                    // Already registered, just updating IP?
                    const info = peerInfo.get(ws.id);
                    if (info) {
                        // Update IP
                        const newIp = normalizeIp(data.ip);
                        if (info.ip !== newIp) {
                            info.ip = newIp;
                            peerInfo.set(ws.id, info);
                            
                            console.log(`Peer ${ws.id} updated IP: ${info.ip}`);
                            
                            // Broadcast update to others
                            broadcast({
                                type: 'peer-updated',
                                peerId: ws.id,
                                name: info.name,
                                ip: info.ip
                            });
                        }
                        
                        // Always acknowledge register logic to keep client happy
                        ws.send(JSON.stringify({ 
                            type: 'registered', 
                            ip: info.ip,
                            peerId: ws.id,
                            name: info.name
                        }));
                    }
                }
            }
            break;

        case 'identify':
            // Only allow identify if already registered
             if (!ws.id) return; 

            // Client identifying themselves with a name AND/OR IP
            if (data.name || data.ip) {
                const info = peerInfo.get(ws.id);
                if (info) {
                    if (data.name) info.name = data.name;
                    if (data.ip) {
                        info.ip = normalizeIp(data.ip);
                        console.log(`Peer ${ws.id} updated IP to ${info.ip}`);
                    }
                    peerInfo.set(ws.id, info);
                    
                    // Broadcast update
                    broadcast({
                        type: 'peer-updated',
                        peerId: ws.id,
                        name: info.name,
                        ip: info.ip
                    });
                    
                    ws.send(JSON.stringify({ type: 'identity-confirmed', name: info.name, ip: info.ip }));
                }
            }
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
                }, ws.id); 
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
                    }, ws.id);
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
