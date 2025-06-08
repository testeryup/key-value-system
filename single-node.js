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
        this.lastSyncTime = 0; // Thời điểm sync cuối cùng
        this.isInitializing = true; // Flag để biết node đang khởi tạo
        this.otherNodes = [
            { host: 'localhost', port: 50051, id: 'kv1' },
            { host: 'localhost', port: 50052, id: 'kv2' },
            { host: 'localhost', port: 50053, id: 'kv3' }
        ].filter(node => node.port !== this.port);

        // Sync configuration
        this.syncRetryAttempts = 3;
        this.syncRetryDelay = 2000; // 2 seconds
    }

    async loadData() {
        try {
            if (await fs.pathExists(this.dbPath)) {
                const rawData = await fs.readFile(this.dbPath, 'utf8');
                const parsedData = JSON.parse(rawData);
                this.data = parsedData.data || parsedData; // Backward compatibility
                this.lastSyncTime = parsedData.lastSyncTime || 0;
                console.log(`[${this.nodeId}] Loaded ${Object.keys(this.data).length} keys from disk`);
                console.log(`[${this.nodeId}] Last sync time: ${new Date(this.lastSyncTime).toISOString()}`);
            } else {
                console.log(`[${this.nodeId}] No existing data file, starting fresh`);
                this.lastSyncTime = Date.now();
            }
        } catch (err) {
            console.error(`[${this.nodeId}] Error loading data:`, err.message);
            this.data = {};
            this.lastSyncTime = Date.now();
        }
    }

    async saveData() {
        try {
            const dataToSave = {
                data: this.data,
                lastSyncTime: this.lastSyncTime,
                savedAt: Date.now()
            };
            await fs.writeFile(this.dbPath, JSON.stringify(dataToSave, null, 2));
        } catch (err) {
            console.error(`[${this.nodeId}] Error saving data:`, err.message);
        }
    }

    // Đồng bộ dữ liệu khi node khởi động
    async performInitialSync() {
        console.log(`[${this.nodeId}] 🔄 Starting initial sync...`);

        let syncSuccessful = false;
        let syncedFromNode = null;

        // Thử sync từ từng node khác
        for (const targetNode of this.otherNodes) {
            try {
                console.log(`[${this.nodeId}] Attempting sync from ${targetNode.id}...`);

                const syncResult = await this.syncFromNode(targetNode);
                if (syncResult.success) {
                    syncSuccessful = true;
                    syncedFromNode = targetNode.id;
                    console.log(`[${this.nodeId}] ✅ Successfully synced from ${targetNode.id}`);
                    console.log(`[${this.nodeId}] Received ${syncResult.itemCount} items`);
                    break;
                }
            } catch (error) {
                console.log(`[${this.nodeId}] ❌ Failed to sync from ${targetNode.id}: ${error.message}`);
                continue;
            }
        }

        if (!syncSuccessful) {
            console.log(`[${this.nodeId}] ⚠️  Could not sync from any node, starting with local data`);
        } else {
            // Update sync time và save
            this.lastSyncTime = Date.now();
            await this.saveData();
            console.log(`[${this.nodeId}] 💾 Sync completed and saved to disk`);
        }

        this.isInitializing = false;
        console.log(`[${this.nodeId}] 🚀 Node ready to serve requests`);
    }

    // Sync dữ liệu từ một node cụ thể
    async syncFromNode(targetNode) {
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
                reject(new Error('Sync timeout'));
            }, 10000); // 10 second timeout

            client.RequestSync({
                nodeId: this.nodeId,
                lastSyncTime: this.lastSyncTime
            }, (err, response) => {
                clearTimeout(timeout);

                if (err) {
                    reject(err);
                    return;
                }

                if (response.success && response.data) {
                    try {
                        // Parse và merge dữ liệu
                        const receivedData = JSON.parse(response.data);
                        const mergedData = this.mergeData(this.data, receivedData);

                        this.data = mergedData;

                        resolve({
                            success: true,
                            itemCount: Object.keys(receivedData).length,
                            mergedCount: Object.keys(this.data).length
                        });
                    } catch (parseError) {
                        reject(new Error(`Failed to parse sync data: ${parseError.message}`));
                    }
                } else {
                    resolve({ success: true, itemCount: 0 }); // No data to sync
                }
            });
        });
    }

    // Merge dữ liệu với conflict resolution (newer timestamp wins)
    mergeData(localData, remoteData) {
        const merged = { ...localData };

        for (const [key, remoteRecord] of Object.entries(remoteData)) {
            const localRecord = merged[key];

            if (!localRecord) {
                // Key không tồn tại locally, add từ remote
                merged[key] = remoteRecord;
                console.log(`[${this.nodeId}] 📥 Added new key: ${key}`);
            } else {
                // Conflict resolution: newer timestamp wins
                const localTimestamp = localRecord.timestamp || 0;
                const remoteTimestamp = remoteRecord.timestamp || 0;

                if (remoteTimestamp > localTimestamp) {
                    merged[key] = remoteRecord;
                    console.log(`[${this.nodeId}] 🔄 Updated key: ${key} (remote newer)`);
                } else if (localTimestamp > remoteTimestamp) {
                    // Keep local version
                    console.log(`[${this.nodeId}] 📌 Kept local key: ${key} (local newer)`);
                } else {
                    // Same timestamp, keep local (tie-breaker)
                    console.log(`[${this.nodeId}] ⚖️  Tie-breaker key: ${key} (kept local)`);
                }
            }
        }

        return merged;
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
            RequestSync: this.handleRequestSync.bind(this) // New sync endpoint
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

                // Perform initial sync after server is ready
                setTimeout(() => {
                    this.performInitialSync();
                }, 1000); // Wait 1 second for server to be fully ready
            }
        );
    }

    // Handle sync requests từ nodes khác
    handleRequestSync(call, callback) {
        try {
            const { nodeId, lastSyncTime } = call.request;
            console.log(`[${this.nodeId}] 📞 Sync request from ${nodeId}, lastSyncTime: ${new Date(parseInt(lastSyncTime)).toISOString()}`);

            // Filter data newer than requester's last sync time
            const filteredData = {};
            let itemCount = 0;

            for (const [key, record] of Object.entries(this.data)) {
                const recordTimestamp = record.timestamp || 0;
                if (recordTimestamp > parseInt(lastSyncTime)) {
                    filteredData[key] = record;
                    itemCount++;
                }
            }

            console.log(`[${this.nodeId}] 📤 Sending ${itemCount} items to ${nodeId}`);

            callback(null, {
                success: true,
                data: JSON.stringify(filteredData),
                itemCount: itemCount,
                timestamp: Date.now()
            });

        } catch (error) {
            console.error(`[${this.nodeId}] Sync request error:`, error.message);
            callback(null, {
                success: false,
                data: '',
                itemCount: 0,
                timestamp: Date.now()
            });
        }
    }

    handleGet(call, callback) {
        try {
            // Reject requests during initialization
            if (this.isInitializing) {
                return callback({
                    code: grpc.status.UNAVAILABLE,
                    message: 'Node is initializing, please try again later'
                });
            }

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
        // Reject requests during initialization
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

            // Update last sync time
            this.lastSyncTime = timestamp;

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
        // Reject requests during initialization
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

            // Update last sync time
            this.lastSyncTime = Date.now();

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
            timestamp: this.lastHeartBeat,
            isInitializing: this.isInitializing // Thêm thông tin về trạng thái khởi tạo
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
                // Conflict resolution: chỉ apply nếu timestamp mới hơn
                const existingRecord = this.data[key];
                if (!existingRecord || incomingTimestamp >= existingRecord.timestamp) {
                    this.data[key] = {
                        value: value,
                        timestamp: incomingTimestamp
                    };
                    console.log(`[${this.nodeId}] REPLICATED PUT ${key} = ${value}`);

                    // Update last sync time if this is newer
                    if (incomingTimestamp > this.lastSyncTime) {
                        this.lastSyncTime = incomingTimestamp;
                    }
                } else {
                    console.log(`[${this.nodeId}] IGNORED PUT ${key} (older timestamp)`);
                }
            }
            else if (operation === "DELETE") {
                // For DELETE, we just remove the key
                delete this.data[key];
                console.log(`[${this.nodeId}] REPLICATED DELETE ${key}`);

                // Update last sync time
                if (incomingTimestamp > this.lastSyncTime) {
                    this.lastSyncTime = incomingTimestamp;
                }
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