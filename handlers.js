const WebSocket = require('ws');
const { files, peerSockets, peerInfo } = require('./store');
const { normalizeIp } = require('./utils');

function handleMessage(ws, data, broadcastFn) {
    switch (data.type) {
        case 'register':
            // Client registering with specific IP/Port (From APK)
            if (data.ip) {
                const info = peerInfo.get(ws.id);
                if (info) {
                    // Update IP
                    info.ip = normalizeIp(data.ip);
                    peerInfo.set(ws.id, info);
                    
                    console.log(`Peer ${ws.id} registered with custom IP: ${info.ip}`);
                    
                    // Broadcast update to others
                    broadcastFn({
                        type: 'peer-updated',
                        peerId: ws.id,
                        name: info.name,
                        ip: info.ip
                    });
                }
            }
            break;

        case 'identify':
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
                    broadcastFn({
                        type: 'peer-updated',
                        peerId: ws.id,
                        name: info.name,
                        ip: info.ip
                    });
                    
                    // Acknowledge
                    ws.send(JSON.stringify({ type: 'identity-confirmed', name: info.name, ip: info.ip }));
                }
            }
            break;

        case 'announce':
            // Client says: "I have this file"
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
                
                broadcastFn({
                    type: 'chat',
                    message: data.message,
                    from: senderName,
                    peerId: ws.id
                }, ws.id); 
            }
            break;

        case 'chat-message':
            // Client sending a chat message (From APK/P2PServer)
            if (data.payload) {
                const info = peerInfo.get(ws.id);
                const senderName = info ? info.name : 'Unknown';
                
                // Extract text from payload
                let text = data.payload.text || data.payload.message || data.payload.content;
                if (!text && typeof data.payload === 'string') text = data.payload;

                if (text) {
                    console.log(`[CHAT-APK] ${senderName}: ${text}`);
                    
                    broadcastFn({
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

module.exports = { handleMessage };
