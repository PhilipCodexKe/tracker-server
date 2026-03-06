const output = document.getElementById('output');
const clock = document.getElementById('clock');
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

// Dynamic Hostname for UI
document.querySelector('.ip').innerText = `NODE: ${window.location.hostname.toUpperCase()}`;

// History Array (Temporary Persistence)
const logHistory = [];

let ws;
let myPeerId;
let currentRoomKey = null;
let myRole = null; // 'host' or 'guest'

// UI Elements
const roomOverlay = document.getElementById('room-overlay');
const roomKeyInput = document.getElementById('room-key-input');
const joinBtn = document.getElementById('join-btn');

function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
}
setInterval(updateClock, 1000);

function log(message, type = 'info') {
    const now = new Date();
    const timestamp = now.toLocaleTimeString();
    
    // Store in array
    logHistory.push({ timestamp, message, type });

    // Render to DOM
    const line = document.createElement('div');
    line.className = 'line';
    line.innerHTML = `<span style="opacity:0.6">[${timestamp}]</span> ${message}`;
    
    if (type === 'error') line.style.color = '#ff5555';
    if (type === 'success') line.style.color = '#50fa7b';
    if (type === 'warning') line.style.color = '#f1fa8c';
    if (type === 'system') line.style.color = '#bd93f9'; // Purple for system events
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

const peersListEl = document.getElementById('peers-list');
// Map<PeerId, {name: string, ip: string}>
const connectedPeers = new Map();

function updatePeersList() {
    peersListEl.innerHTML = '';
    
    if (connectedPeers.size === 0) {
        peersListEl.innerHTML = '<div style="opacity:0.5; font-style:italic;">Scanning for peers...</div>';
        return;
    }

    connectedPeers.forEach((info, id) => {
        const item = document.createElement('div');
        item.className = 'peer-block';
        item.innerHTML = `
            <div class="peer-deco">[----------]</div>
            <div class="peer-info">NAME: ${info.name}</div>
            <div class="peer-info">IP:   ${info.ip}</div>
            <div class="peer-info">ID:   ${id}</div>
            <div class="peer-deco">[----------]</div>
        `;
        peersListEl.appendChild(item);
    });
}

function connect() {
    log('Initiating handshake protocol...', 'info');
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        log('Connection established [SECURE]', 'success');
        log('Waiting for network activity...');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'welcome':
                    log(`Identity confirmed. Cluster Access Granted.`, 'success');
                    log(`Peer ID: ${data.peerId}`, 'system');
                    log(`Room Key: ${data.roomKey}`, 'system');
                    log(`Role: ${data.role.toUpperCase()}`, 'system');
                    
                    document.title = `NODE: ${data.peerId.substring(0, 8)}... [${data.roomKey}] (${data.role})`;
                    document.querySelector('.status').innerText = `STATUS: [ONLINE] - ROLE: ${data.role.toUpperCase()}`;
                    
                    myPeerId = data.peerId;
                    currentRoomKey = data.roomKey;
                    myRole = data.role;
                    
                    // Hide overlay if still visible
                    roomOverlay.style.display = 'none';

                    // Add Self to List
                    connectedPeers.set(data.peerId, { 
                        name: data.name + " (YOU)", 
                        ip: data.ip 
                    });
                    updatePeersList();
                    break;
                
                case 'connection-log':
                    log(`[LOG] ${data.message}`, data.level || 'info');
                    break;

                case 'greeting':
                    log(data.message, 'success');
                    break;
                case 'error':
                    log(`Error: ${data.message}`, 'error');
                    break;
                
                // Peer Management Events
                case 'peer-joined':
                    log(`New Peer Detected: ${data.name} (${data.peerId})`, 'system');
                    connectedPeers.set(data.peerId, { name: data.name, ip: data.ip });
                    updatePeersList();
                    break;
                case 'peer-updated':
                    // Name change or other update
                    log(`Peer Updated: ${data.name} (${data.peerId})`, 'system');
                    connectedPeers.set(data.peerId, { name: data.name, ip: data.ip });
                    updatePeersList();
                    break;
                case 'identity-confirmed':
                    // We changed our own name
                    log(`Identity Confirmed: ${data.name}`, 'success');
                    if (myPeerId && connectedPeers.has(myPeerId)) {
                        const myInfo = connectedPeers.get(myPeerId);
                        myInfo.name = data.name + " (YOU)";
                        connectedPeers.set(myPeerId, myInfo);
                        updatePeersList();
                    }
                    break;

                case 'peer-left':
                    log(`Peer Disconnected: ${data.name || data.peerId}`, 'warning');
                    connectedPeers.delete(data.peerId);
                    updatePeersList();
                    break;
                case 'peer-list-snapshot':
                    // Initial load of existing peers - LATE JOINER LOGIC
                    log(`Discovered ${data.peers.length} existing peers in cluster. Initiating handshakes...`, 'system');
                    data.peers.forEach(p => {
                        connectedPeers.set(p.peerId, { name: p.name, ip: p.ip });
                        
                        // Perform handshake with this existing peer
                        log(`[HANDSHAKE] Sending offer to ${p.name || p.peerId}...`, 'info');
                        const mockSdpOffer = { type: 'offer', sdp: `v=0... (mesh offer for ${p.peerId})` };
                        ws.send(JSON.stringify({
                            type: 'signal',
                            to: p.peerId,
                            signal: mockSdpOffer,
                            isInitial: true // Mark as initial handshake request
                        }));
                    });
                    updatePeersList();
                    break;

                case 'chat':
                    log(`[CHAT] ${data.from}: ${data.message}`, 'warning'); // Using warning color (yellowish) for visibility
                    break;

                case 'peers':
                    log(`Swarm update: ${data.peers.length} active peers for file`, 'info');
                    break;
                case 'signal':
                    log(`Signal received from ${data.from}. Proceeding with handshake...`, 'system');
                    if (data.isInitial) {
                        log(`Received initial SDP offer from ${data.from}. Generating answer...`, 'info');
                        // Simulation of WebRTC Answer
                        setTimeout(() => {
                            ws.send(JSON.stringify({
                                type: 'signal',
                                to: data.from,
                                signal: { type: 'answer', sdp: 'v=0... (simulated answer)' }
                            }));
                        }, 1000);
                    } else if (data.signal && data.signal.type === 'answer') {
                        log(`Received SDP answer from host. Finalizing P2P sync...`, 'success');
                        log(`P2P Connection ESTABLISHED via hole punching.`, 'success');
                    }
                    break;
                default:
                    log(`Data received: ${data.type}`);
            }
        } catch (e) {
            log('Raw packet received', 'info');
        }
    };

    ws.onclose = () => {
        log('Connection lost. Retrying in 5000ms...', 'error');
        setTimeout(connect, 5000);
    };

    ws.onerror = (err) => {
        log(`Socket error: ${err.message || 'Unknown'}`, 'error');
        ws.close();
    };
}

function joinRoom() {
    const key = roomKeyInput.value.trim().toUpperCase();
    if (!key) {
        alert("Please enter a room key.");
        return;
    }

    currentRoomKey = key;
    roomOverlay.style.display = 'none';
    
    // Connect to server
    connect();

    // After connecting, we need to send the join-room message.
    // We'll wait for the greeting or onopen to send it.
    // To ensure it sends AFTER connection, we'll wrap it.
    const originalOnOpen = ws.onopen;
    ws.onopen = (e) => {
        if (originalOnOpen) originalOnOpen(e);
        log(`Negotiating entry into room ${key}...`, 'system');
        
        // Join the room. Handshakes will be initiated upon receiving 'peer-list-snapshot'
        ws.send(JSON.stringify({
            type: 'join-room',
            roomKey: key
        }));
    };
}

joinBtn.addEventListener('click', joinRoom);
roomKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
});

// Focus room input on load
window.onload = () => roomKeyInput.focus();

// Chat Input Handling
const chatInput = document.getElementById('chat-input');
chatInput.focus();

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const text = chatInput.value.trim();
        if (text) {
            // Handle special commands here if needed, or just default to chat
            
            // Send Chat to Server
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'chat',
                    message: text
                }));
                
                // Server excludes sender from broadcast, so we log it ourselves
                log(`[CHAT] Me: ${text}`, 'warning');
                
                chatInput.value = '';
            } else {
                log('Error: Not connected to server', 'error');
            }
        }
    }
});

// Keep focus
document.addEventListener('click', () => chatInput.focus());

// Start (Wait for user)
// connect(); removed - triggered by joinRoom()
