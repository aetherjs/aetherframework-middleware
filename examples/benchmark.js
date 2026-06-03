/**
 * Simple Benchmark Script
 * Compares raw HTTP vs Aether Pipeline overhead.
 */
import http from 'http';
import { AetherPipeline, AetherContext } from '../index.js'; 
import json from "../src/middleware/json.js";

const ITERATIONS = 10000;

// 1. Raw HTTP Server
const rawServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
});

// 2. Aether Server
const pipeline = new AetherPipeline();
pipeline.use(json());
pipeline.use(async (ctx, signal) => {
    ctx.body = { status: 'ok' };
    await signal.next();
});

const aetherServer = http.createServer(async (req, res) => {

    try {
        if (!req || !res) {
            console.error('ERROR: req or res is undefined');
            res.writeHead(500);
            res.end('Internal Server Error');
            return;
        }
        
        await pipeline.handle(req, res);
    } catch (error) {
        console.error('Pipeline execution error:', error);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end('Internal Server Error');
        }
    }
});

async function runBenchmark(server, name) {
    return new Promise((resolve) => {
        server.listen(0, () => {
            const port = server.address().port;
            const start = Date.now();
            let completed = 0;

            function makeRequest() {
                http.get(`http://localhost:${port}/`, (res) => {
                    res.resume();
                    res.on('end', () => {
                        completed++;
                        if (completed < ITERATIONS) {
                            makeRequest();
                        } else {
                            const duration = Date.now() - start;
                            const rps = (ITERATIONS / duration) * 1000;
                            console.log(`${name}: ${duration}ms for ${ITERATIONS} requests (${rps.toFixed(0)} req/sec)`);
                            server.close(() => resolve());
                        }
                    });
                }).on('error', (e) => {
                    console.error(e);
                    server.close(() => resolve());
                });
            }
            
            makeRequest();
        });
    });
}

async function main() {
  
    
    await runBenchmark(rawServer, 'Raw HTTP');
    await runBenchmark(aetherServer, 'Aether Pipeline');
 
}

main().catch(console.error);
