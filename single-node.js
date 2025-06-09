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
        this.lastSyncTime = 0; // Có thể bỏ vì dùng savedAt
        this.savedAt = 0; // Timestamp when data was last saved
        this.isInitializing = true;
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
                const parsedData = JSON.parse(rawData);

                this.data = parsedData.data || parsedData;
                this.savedAt = parsedData.savedAt || 0;
                // Backward compatibility
                this.lastSyncTime = parsedData.lastSyncTime || this.savedAt;

                console.log(`[${this.nodeId}] Loaded ${Object.keys(this.data).length} keys from disk`);
                console.log(`[${this.nodeId}] Last saved at: ${new Date(this.savedAt).toISOString()}`);
            } else {
                console.log(`[${this.nodeId}] No existing data file, starting fresh`);
                this.savedAt = Date.now();
                this.lastSyncTime = this.savedAt;
            }
        } catch (err) {
            console.error(`[${this.nodeId}] Error loading data:`, err.message);
            this.data = {};
            this.savedAt = Date.now();
            this.lastSyncTime = this.savedAt;
        }
    }

    async saveData() {
        try {
            this.savedAt = Date.now();
            const dataToSave = {
                data: this.data,
                savedAt: this.savedAt
                // Bỏ lastSyncTime vì trùng với savedAt
            };
            await fs.writeFile(this.dbPath, JSON.stringify(dataToSave, null, 2));
        } catch (err) {
            console.error(`[${this.nodeId}] Error saving data:`, err.message);
        }
    }

    // Đồng bộ dữ liệu khi node khởi động - SIMPLIFIED VERSION
    async performInitialSync() {
        console.log(`[${this.nodeId}] 🔄 Starting initial sync...`);
        console.log(`[${this.nodeId}] Current savedAt: ${new Date(this.savedAt).toISOString()}`);

        let syncSuccessful = false;
        let newestNode = null;
        let newestTimestamp = this.savedAt;

        // Tìm node có savedAt mới nhất
        for (const targetNode of this.otherNodes) {
            try {
                console.log(`[${this.nodeId}] Checking ${targetNode.id}...`);

                const nodeInfo = await this.getNodeInfo(targetNode);
                if (nodeInfo.success && nodeInfo.savedAt > newestTimestamp) {
                    newestTimestamp = nodeInfo.savedAt;
                    newestNode = targetNode;
                    console.log(`[${this.nodeId}] Found newer data on ${targetNode.id}: ${new Date(nodeInfo.savedAt).toISOString()}`);
                }
            } catch (error) {
                console.log(`[${this.nodeId}] ❌ Cannot check ${targetNode.id}: ${error.message}`);
                continue;
            }
        }

        if (newestNode && newestTimestamp > this.savedAt) {
            // Copy toàn bộ data từ node mới nhất
            try {
                console.log(`[${this.nodeId}] 📥 Copying all data from ${newestNode.id}...`);
                const syncResult = await this.copyAllDataFromNode(newestNode);

                if (syncResult.success) {
                    this.data = syncResult.data;
                    await this.saveData();
                    syncSuccessful = true;
                    console.log(`[${this.nodeId}] ✅ Successfully copied ${Object.keys(this.data).length} keys from ${newestNode.id}`);
                }
            } catch (error) {
                console.log(`[${this.nodeId}] ❌ Failed to copy from ${newestNode.id}: ${error.message}`);
            }
        } else {
            console.log(`[${this.nodeId}] ℹ️  Local data is up-to-date, no sync needed`);
            syncSuccessful = true;
        }

        if (!syncSuccessful) {
            console.log(`[${this.nodeId}] ⚠️  Could not sync from any node, starting with local data`);
        }

        this.isInitializing = false;
        console.log(`[${this.nodeId}] 🚀 Node ready to serve requests`);
    }

    // Lấy thông tin metadata của một node (savedAt, itemCount)
    async getNodeInfo(targetNode) {
        const packageDefinition = protoLoader.loadSync(
            path.join(__dirname, 'single-node.proto'),
            { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
        );
        const kvProto = grpc.loadPackageDefinition(packageDefinition).keyvalue;

        const client = new kvProto.KeyValueService(
            `${targetNode.host}:${targetNode.port}`,
            grpc.credentials.createInsecure()
        );

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout'));
            }, 5000);

            client.GetNodeInfo({ nodeId: this.nodeId }, (err, response) => {
                clearTimeout(timeout);
                if (err) {
                    reject(err);
                } else {
                    resolve(response);
                }
            });
        });
    }

    // Copy toàn bộ data từ một node khác
    async copyAllDataFromNode(targetNode) {
        const packageDefinition = protoLoader.loadSync(
            path.join(__dirname, 'single-node.proto'),
            { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
        );
        const kvProto = grpc.loadPackageDefinition(packageDefinition).keyvalue;

        const client = new kvProto.KeyValueService(
            `${targetNode.host}:${targetNode.port}`,
            grpc.credentials.createInsecure()
        );

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Copy timeout'));
            }, 15000); // Longer timeout cho copy all data

            client.CopyAllData({ nodeId: this.nodeId }, (err, response) => {
                clearTimeout(timeout);

                if (err) {
                    reject(err);
                    return;
                }

                if (response.success && response.data) {
                    try {
                        const data = JSON.parse(response.data);
                        resolve({
                            success: true,
                            data: data,
                            itemCount: Object.keys(data).length
                        });
                    } catch (parseError) {
                        reject(new Error(`Failed to parse data: ${parseError.message}`));
                    }
                } else {
                    reject(new Error('No data received'));
                }
            });
        });
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
            Replicate: this.handleReplicate.bind(this),
            GetNodeInfo: this.handleGetNodeInfo.bind(this), // NEW: Return node metadata
            CopyAllData: this.handleCopyAllData.bind(this), // NEW: Return all data
            // Remove RequestSync - không cần nữa
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

                setTimeout(() => {
                    this.performInitialSync();
                }, 1000);
            }
        );
    }

    // NEW: Handle GetNodeInfo requests
    handleGetNodeInfo(call, callback) {
        try {
            const { nodeId } = call.request;
            console.log(`[${this.nodeId}] 📊 Node info request from ${nodeId}`);

            callback(null, {
                success: true,
                savedAt: this.savedAt,
                itemCount: Object.keys(this.data).length,
                nodeId: this.nodeId,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`[${this.nodeId}] GetNodeInfo error:`, error.message);
            callback(null, {
                success: false,
                savedAt: 0,
                itemCount: 0,
                nodeId: this.nodeId,
                timestamp: Date.now()
            });
        }
    }

    // NEW: Handle CopyAllData requests
    handleCopyAllData(call, callback) {
        try {
            const { nodeId } = call.request;
            console.log(`[${this.nodeId}] 📤 Copy all data request from ${nodeId}`);
            console.log(`[${this.nodeId}] Sending ${Object.keys(this.data).length} items`);

            callback(null, {
                success: true,
                data: JSON.stringify(this.data),
                itemCount: Object.keys(this.data).length,
                savedAt: this.savedAt,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error(`[${this.nodeId}] CopyAllData error:`, error.message);
            callback(null, {
                success: false,
                data: '{}',
                itemCount: 0,
                savedAt: 0,
                timestamp: Date.now()
            });
        }
    }

    async handlePut(call, callback) {
        if (this.isInitializing) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'Node is initializing, please try again later'
            });
        }

        const { key, value } = call.request;
        try {
            const timestamp = Date.now();
            this.data[key] = {
                value: value,
                timestamp: timestamp
            };

            await this.saveData(); // savedAt sẽ được update trong saveData()
            console.log(`[${this.nodeId}] PUT ${key} = ${value}`);
            await this.replicateToOthers('PUT', key, value, timestamp);
            callback(null, { success: true });
        } catch (error) {
            console.error(`[${this.nodeId}] PUT error:`, error.message);
            callback(null, { success: false });
        }
    }

    async handleDelete(call, callback) {
        if (this.isInitializing) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'Node is initializing, please try again later'
            });
        }

        const { key } = call.request;
        try {
            const existed = this.data[key] !== undefined;
            delete this.data[key];

            await this.saveData(); // savedAt sẽ được update trong saveData()
            console.log(`[${this.nodeId}] DELETE ${key} -> ${existed ? 'SUCCESS' : 'Không tìm thấy'}`);
            await this.replicateToOthers('DELETE', key);
            callback(null, { success: true });
        } catch (error) {
            console.error(`[${this.nodeId}] DELETE error:`, error.message);
            callback(null, { success: false });
        }
    }

    // Các methods khác giữ nguyên...
    handleGet(call, callback) {
        try {
            if (this.isInitializing) {
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    message: 'Node is initializing, please try again later'
                });
            }

            const { key } = call.request;
            const record = this.data[key];

            if (record) {
                console.log(`[${this.nodeId}] GET ${key} -> ${record.value}`);
                callback(null, {
                    value: record.value,
                    found: true
                });
            } else {
                console.log(`[${this.nodeId}] GET ${key} -> Không tìm thấy`);
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

    handleHealthCheck(call, callback) {
        this.lastHeartBeat = Date.now();
        callback(null, {
            healthy: true,
            timestamp: this.lastHeartBeat,
            isInitializing: this.isInitializing
        });
    }

    async handleReplicate(call, callback) {
        const { operation, key, value, timestamp } = call.request;
        if (!operation || !key) {
            return callback(null, { success: false });
        }

        try {
            const incomingTimestamp = parseInt(timestamp) || Date.now();

            if (operation === 'PUT') {
                const existingRecord = this.data[key];
                if (!existingRecord || incomingTimestamp >= existingRecord.timestamp) {
                    this.data[key] = {
                        value: value,
                        timestamp: incomingTimestamp
                    };
                    console.log(`[${this.nodeId}] REPLICATED PUT ${key} = ${value}`);
                } else {
                    console.log(`[${this.nodeId}] IGNORED PUT ${key} (older timestamp)`);
                }
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