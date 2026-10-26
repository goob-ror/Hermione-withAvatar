import json
import sys
import urllib.request

BASE = 'http://localhost:3123'
MODEL = 'qwen3.5-9b:latest'


def run(path, payload, timeout=600):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'},
    )
    events = []
    buf = b''
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            buf += chunk
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.strip()
                if line:
                    events.append(json.loads(line))
    return events


def show(events, limit=400):
    for e in events:
        t = e['type']
        if t == 'thinking':
            continue
        if t == 'token':
            continue
        if t == 'tool_call':
            print(f"  tool_call   {e['tool']} tier={e['tier']} group={e['group']} args={json.dumps(e['args'])[:160]} callId={e['callId']}")
        elif t == 'tool_result':
            out = e['output'].replace('\n', ' | ')[:limit]
            print(f"  tool_result {e['tool']} ok={e['ok']} :: {out}")
        elif t == 'approval_required':
            print(f"  APPROVAL    {e['tool']} args={json.dumps(e['args'])[:160]} callId={e['callId']} :: {e['reason']}")
        elif t == 'final':
            print(f"  final       {e['text'][:limit]}")
        elif t == 'error':
            print(f"  ERROR       {e['message']}")
    tokens = sum(len(e['delta']) for e in events if e['type'] == 'token')
    think = sum(len(e['delta']) for e in events if e['type'] == 'thinking')
    print(f"  [stream: {len(events)} events, {tokens} content chars, {think} thinking chars]")
    return [e for e in events if e['type'] == 'approval_required']


if __name__ == '__main__':
    mode = sys.argv[1]

    if mode == 'auto':
        print('== TEST A: auto-tier tool (fs_list) ==')
        ev = run('/api/agent', {
            'sessionId': 'test_auto',
            'model': MODEL,
            'enableThinking': False,
            'message': 'Use the fs_list tool on the directory "lib/agent" and then tell me exactly which files are there. Do not guess.',
        })
        show(ev)

    elif mode == 'confirm':
        print('== TEST B: confirm-tier tool (fs_write) ==')
        ev = run('/api/agent', {
            'sessionId': 'test_confirm',
            'model': MODEL,
            'enableThinking': False,
            'message': 'Create a file at scratch/gate-test.txt whose content is exactly: approved-by-gate',
        })
        pending = show(ev)
        if not pending:
            print('!! no approval requested')
            sys.exit(1)
        call = pending[0]
        print(f"-- approving {call['callId']} --")
        ev2 = run('/api/agent/approve', {
            'sessionId': 'test_confirm',
            'callId': call['callId'],
            'decision': 'approve',
            'enableThinking': False,
        })
        show(ev2)

    elif mode == 'deny':
        print('== TEST C: deny path (shell_run) ==')
        ev = run('/api/agent', {
            'sessionId': 'test_deny',
            'model': MODEL,
            'enableThinking': False,
            'message': 'Run the shell command "ls -la" so I can see the project root.',
        })
        pending = show(ev)
        if not pending:
            print('!! no approval requested')
            sys.exit(1)
        call = pending[0]
        print(f"-- denying {call['callId']} --")
        ev2 = run('/api/agent/approve', {
            'sessionId': 'test_deny',
            'callId': call['callId'],
            'decision': 'deny',
            'enableThinking': False,
        })
        show(ev2)
