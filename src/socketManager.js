const WebSocket = require('ws');
const { files, peerSockets, peerInfo, getNextAnonymousName } = require('./store');
const { ipToNumber, normalizeIp } = require('./utils');
const { handleMessage } = require('./handlers');

function initializeSockets(wss) {
    
    function broadcast(data, excludePeerId = null) {
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN && client.id !== excludePeerId) {
                client.send(JSON.stringify(data));
            }
        });
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

    wss.on('connection', (ws, req) => {
        // 1. Get IP Address
        let rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        if (Array.isArray(rawIp)) rawIp = rawIp[0];
        const ip = normalizeIp(rawIp);
        
        // 2. Generate ID: Random * IP-based-number to get 16-digit ID
        const ipNum = BigInt(ipToNumber(ip));
        const r1 = Math.floor(Math.random() * 1000000000);
        const r2 = Math.floor(Math.random() * 1000000000);
        const randomBase = BigInt(r1) * BigInt(r2);
        const generatedIdVal = randomBase * (ipNum || 1n);
        const newPeerId = generatedIdVal.toString(16).padStart(16, '0').slice(-16).toUpperCase(); 
    
        ws.id = newPeerId;
        ws.isAlive = true; 
        ws.on('pong', () => { ws.isAlive = true; }); 
    
        // 3. Default Name
        const defaultName = getNextAnonymousName();
        
        // Store
        peerSockets.set(ws.id, ws);
        peerInfo.set(ws.id, { name: defaultName, ip: ip });
    
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] Peer connected: ${ws.id} (${ip})`);
        
        // Broadcast to others
        broadcast({ 
            type: 'peer-joined', 
            peerId: ws.id,
            name: defaultName,
            ip: ip
        }, ws.id);
    
        // Welcome the new peer
        ws.send(JSON.stringify({ 
            type: 'welcome', 
            peerId: ws.id,
            name: defaultName,
            ip: ip
        }));
        
        // Explicitly send "your-info"
        ws.send(JSON.stringify({
            type: 'your-info',
            name: defaultName,
            peerId: ws.id,
            ip: ip
        }));
    
        ws.send(JSON.stringify({ type: 'greeting', message: "Hello welcome I'm the tracker" }));
    
        // Send existing peers list
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
    
        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                handleMessage(ws, data, broadcast);
            } catch (e) {
                console.error('Failed to parse message', e);
            }
        });
    
        ws.on('close', () => {
            console.log(`Peer disconnected: ${ws.id}`);
            const info = peerInfo.get(ws.id);
            const name = info ? info.name : 'Unknown';
    
            cleanupPeer(ws.id);
            
            broadcast({ 
                type: 'peer-left', 
                peerId: ws.id,
                name: name
            });
        });
    });

    // Heartbeat
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
}

module.exports = { initializeSockets };
