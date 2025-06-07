const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs-extra');
const path = require('path');

class KVNode {
    constructor(port, nodeId) {
        this.port = port;
        this.nodeId = nodeId;
        this.dbPath = path.join(__dirname, `${nodeId}-db.json`);
        this.data = {};
        this.lastHeartBeat = Date.now();
        this.otherNodes = [
            { host: 'localhost', port: 50051, id: 'kv1' },
            { host: 'localhost', port: 50052, id: 'kv2' },
            { host: 'localhost', port: 50053, id: 'kv3' }
        ].filter(node => node.port !== this.port);
    }

    async loadData() {
        try {
            if (await fs.pathExists(this.dbPath)) {
                const rawData = await fs.readFile(this.dbPath, 'utf8');
                this.data = JSON.parse(rawData);
                console.log(`[${this.nodeId}] Loaded ${Object.keys(this.data).length} keys from disk`);
            }
        } catch (err) {
            console.error(`[${this.nodeId}] Error loading data:`, err.message);
            this.data = {};
        }
    }

    async saveData() {
        try {
            await fs.writeFile(this.dbPath, JSON.stringify(this.data, null, 2));
        } catch (err) {
            console.error(`[${this.nodeId}] Error saving data:`, err.message);
        }
    }

    setupGrpcServer() {
        const packageDefinition = protoLoader.loadSync(
            path.join(__dirname, 'single-node.proto'),
            {
                keepCase: true,
                longs: String,
                enums: String,
                defaults: true,
                oneofs: true
            }
        );

        const kvProto = grpc.loadPackageDefinition(packageDefinition).keyvalue;
        this.server = new grpc.Server();

        this.server.addService(kvProto.KeyValueService.service, {
            Get: this.handleGet.bind(this),
            Put: this.handlePut.bind(this),
            Delete: this.handleDelete.bind(this),
            HealthCheck: this.handleHealthCheck.bind(this),
            Replicate: this.handleReplicate.bind(this)
        });

        this.server.bindAsync(
            `0.0.0.0:${this.port}`,
            grpc.ServerCredentials.createInsecure(),
            (err, port) => {
                if (err) {
                    console.error(`[${this.nodeId}] Failed to start server:`, err);
                    return;
                }
                console.log(`[${this.nodeId}] KV Node started on port ${port}`);
            }
        );
    }

    handleGet(call, callback) {
        try {
            const { key } = call.request;
            const record = this.data[key];

            if (record) {
                console.log(`[${this.nodeId}] GET ${key} -> ${record.value} (${new Date(record.timestamp).toISOString()})`);
                callback(null, {
                    value: record.value,
                    found: true
                });
            } else {
                console.log(`[${this.nodeId}] GET ${key} -> NOT_FOUND`);
                callback(null, {
                    value: '',
                    found: false
                });
            }
        } catch (error) {
            console.error(`[${this.nodeId}] GET error:`, error.message);
            callback(null, { value: '', found: false });
        }
    }

    async handlePut(call, callback) {
        const { key, value } = call.request;
        try {
            const timestamp = Date.now();
            this.data[key] = {
                value: value,
                timestamp: timestamp
            };

            await this.saveData();
            console.log(`[${this.nodeId}] PUT ${key} = ${value} (${new Date(timestamp).toISOString()})`);
            await this.replicateToOthers('PUT', key, value, timestamp);
            callback(null, { success: true });
        } catch (error) {
            console.error(`[${this.nodeId}] PUT error:`, error.message);
            callback(null, { success: false });
        }
    }

    async handleDelete(call, callback) {
        const { key } = call.request;
        try {
            const existed = this.data[key] !== undefined;
            delete this.data[key];
            await this.saveData();
            console.log(`[${this.nodeId}] DELETE ${key} -> ${existed ? 'SUCCESS' : 'NOT_FOUND'}`);
            await this.replicateToOthers('DELETE', key);
            callback(null, { success: true });
        } catch (error) {
            console.error(`[${this.nodeId}] DELETE error:`, error.message);
            callback(null, { success: false });
        }
    }

    handleHealthCheck(call, callback) {
        this.lastHeartBeat = Date.now();
        callback(null, {
            healthy: true,
            timestamp: this.lastHeartBeat
        });
    }

    async handleReplicate(call, callback) {
        const { operation, key, value, timestamp } = call.request;
        if (!operation || !key) {
            return callback(null, { success: false });
        }

        try {
            if (operation === 'PUT') {
                this.data[key] = {
                    value: value,
                    timestamp: parseInt(timestamp) || Date.now()
                };
                console.log(`[${this.nodeId}] REPLICATED PUT ${key} = ${value}`);
            }
            else if (operation === "DELETE") {
                delete this.data[key];
                console.log(`[${this.nodeId}] REPLICATED DELETE ${key}`);
            }
            await this.saveData();
            callback(null, { success: true });
        } catch (error) {
            console.error(`[${this.nodeId}] Replication error:`, error.message);
            callback(null, { success: false });
        }
    }

    async replicateToOthers(operation, key, value, timestamp) {
        const packageDefinition = protoLoader.loadSync(
            path.join(__dirname, 'single-node.proto'),
            { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
        );
        const kvProto = grpc.loadPackageDefinition(packageDefinition).keyvalue;

        const promises = this.otherNodes.map(async (node) => {
            try {
                const client = new kvProto.KeyValueService(
                    `${node.host}:${node.port}`,
                    grpc.credentials.createInsecure()
                );
                return new Promise((resolve, reject) => {
                    client.Replicate({ operation, key, value, timestamp }, (err, response) => {
                        if (err) {
                            console.log(`Cannot replicate to node: ${node.id}`);
                            reject(err);
                        }
                        else {
                            console.log(`Replicate successfully to node: ${node.id}`);
                            resolve(response);
                        }
                    });
                });
            } catch (error) {
                console.error(`[${this.nodeId}] Replication setup error for ${node.id}:`, error.message);
            }
        });

        try {
            await Promise.allSettled(promises);
        } catch (error) {
            console.error(`[${this.nodeId}] Replication errors:`, error.message);
        }
    }
}

async function startNode() {
    const port = process.argv[2] || 50051;
    const nodeId = process.argv[3] || 'kv1';

    const node = new KVNode(parseInt(port), nodeId);
    await node.loadData();
    node.setupGrpcServer();

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log(`\n[${nodeId}] Shutting down...`);
        if (node.server) {
            node.server.tryShutdown(() => {
                process.exit(0);
            });
        }
    });
}

if (require.main === module) {
    startNode().catch(console.error);
}

module.exports = KVNode;