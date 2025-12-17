const output = document.getElementById('output');
const clock = document.getElementById('clock');
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}`;

// Dynamic Hostname for UI
document.querySelector('.ip').innerText = `NODE: ${window.location.hostname.toUpperCase()}`;

let ws;

function updateClock() {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString();
}
setInterval(updateClock, 1000);

function log(message, type = 'info') {
    const line = document.createElement('div');
    line.className = 'line';
    
    const timestamp = new Date().toLocaleTimeString();
    line.innerHTML = `<span style="opacity:0.6">[${timestamp}]</span> ${message}`;
    
    if (type === 'error') line.style.color = 'red';
    if (type === 'success') line.style.color = '#fff';
    
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
}

function connect() {
    log('Initiating handshake protocol...', 'info');
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        log('Connection established [SECURE]', 'success');
        log('Waiting for peer identification...');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'welcome') {
                log(`Identity assigned: ${data.peerId}`, 'success');
                document.title = `NODE: ${data.peerId.substring(0, 8)}...`;
            } else if (data.type === 'error') {
                log(`Error: ${data.message}`, 'error');
            } else if (data.type === 'peers') {
                log(`Swarm data received. Active peers: ${data.peers.length}`);
            } else if (data.type === 'signal') {
                log(`Encrypted signal received from ${data.from}`);
            } else {
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

// Start
connect();
