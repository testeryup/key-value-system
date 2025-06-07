const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs-extra');
const path = require('path');

class LoadBalancer {
    constructor(sharedPort, mode = 'primary', backupPort = null) {
        this.sharedPort = sharedPort; // The port both LBs compete for
        this.backupPort = backupPort; // Backup port for coordination
        this.mode = mode; // 'primary' or 'secondary'
        this.currentPort = null; // Currently bound port
        this.isPrimary = mode === 'primary';
        this.isActive = false;
        this.server = null;
        this.coordinationServer = null; // For health checks when not active

        this.nodes = [
            { id: 'kv1', host: 'localhost', port: 50051, healthy: false, lastCheck: 0 },
            { id: 'kv2', host: 'localhost', port: 50052, healthy: false, lastCheck: 0 },
            { id: 'kv3', host: 'localhost', port: 50053, healthy: false, lastCheck: 0 }
        ];
        this.currentNodeIndex = 0;
        this.healthCheckInterval = 5000;
        this.leaderElectionInterval = 2000; // Check more frequently
        this.clients = new Map();

        // Leader election state
        this.lastHeartbeat = Date.now();
        this.otherLbHealthy = false;
        this.otherLbClient = null;
        this.failoverAttempts = 0;
        this.maxFailoverAttempts = 3;
    }

    async start() {
        await this.startCoordinationServer();
        this.startHealthChecks();
        this.startLeaderElection();
        console.log(`[LoadBalancer-${this.mode}] Started, competing for port ${this.sharedPort}`);
    }

    // Setup coordination server for health checks (always running)
    async startCoordinationServer() {
        if (!this.backupPort) return;

        return new Promise((resolve, reject) => {
            const packageDefinition = protoLoader.loadSync(
                path.join(__dirname, 'load-balancer.proto'),
                {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true
                }
            );

            const lbProto = grpc.loadPackageDefinition(packageDefinition).loadbalancer;
            this.coordinationServer = new grpc.Server();

            // Only health check and status for coordination
            this.coordinationServer.addService(lbProto.LoadBalancerService.service, {
                Get: this.handleInactive.bind(this),
                Put: this.handleInactive.bind(this),
                Delete: this.handleInactive.bind(this),
                HealthCheck: this.handleLbHealthCheck.bind(this),
                GetStatus: this.handleGetStatus.bind(this)
            });

            this.coordinationServer.bindAsync(
                `0.0.0.0:${this.backupPort}`,
                grpc.ServerCredentials.createInsecure(),
                (err, port) => {
                    if (err) {
                        console.error(`[LoadBalancer-${this.mode}] Failed to start coordination server:`, err);
                        resolve(); // Continue without coordination
                        return;
                    }
                    console.log(`[LoadBalancer-${this.mode}] Coordination server on port ${port}`);
                    resolve();
                }
            );
        });
    }

    // Handle requests when inactive (redirect or reject)
    handleInactive(call, callback) {
        callback({
            code: grpc.status.UNAVAILABLE,
            message: `Load balancer is inactive. Try port ${this.sharedPort}`
        });
    }

    // Leader election with port competition
    startLeaderElection() {
        setInterval(() => {
            this.checkLeaderStatus();
        }, this.leaderElectionInterval);

        // Initial check
        setTimeout(() => this.checkLeaderStatus(), this.isPrimary ? 100 : 500); // Primary tries first
    }

    async checkLeaderStatus() {
        try {
            // Check if other LB is healthy via backup port
            await this.checkOtherLoadBalancer();

            if (this.isActive) {
                // We're currently active, check if we should stay active
                if (this.otherLbHealthy && this.mode === 'secondary') {
                    // Secondary should give way to healthy primary
                    const otherStatus = await this.getOtherLbStatus();
                    if (otherStatus.mode === 'primary' && !otherStatus.isActive) {
                        // Primary is healthy but not active, let it take over
                        await this.becomeInactive();
                        return;
                    }
                }
                // Stay active if we're primary or if other LB is unhealthy
            } else {
                // We're currently inactive, try to become active
                const shouldTakeOver = !this.otherLbHealthy ||
                    (this.isPrimary && this.otherLbHealthy && !(await this.isOtherLbActive()));

                if (shouldTakeOver) {
                    await this.attemptToTakePort();
                }
            }
        } catch (error) {
            console.error(`[LoadBalancer-${this.mode}] Leader election error:`, error.message);
            if (!this.isActive && (this.isPrimary || !this.otherLbHealthy)) {
                await this.attemptToTakePort();
            }
        }
    }

    async attemptToTakePort() {
        try {
            await this.setupMainServer();
            this.becomeActive();
            this.failoverAttempts = 0;
        } catch (error) {
            this.failoverAttempts++;
            if (this.failoverAttempts >= this.maxFailoverAttempts) {
                console.error(`[LoadBalancer-${this.mode}] Failed to bind to port ${this.sharedPort} after ${this.maxFailoverAttempts} attempts`);
                this.failoverAttempts = 0; // Reset for next cycle
            }
        }
    }

    async setupMainServer() {
        return new Promise((resolve, reject) => {
            const packageDefinition = protoLoader.loadSync(
                path.join(__dirname, 'load-balancer.proto'),
                {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true
                }
            );

            const lbProto = grpc.loadPackageDefinition(packageDefinition).loadbalancer;
            this.server = new grpc.Server();

            this.server.addService(lbProto.LoadBalancerService.service, {
                Get: this.handleGet.bind(this),
                Put: this.handlePut.bind(this),
                Delete: this.handleDelete.bind(this),
                HealthCheck: this.handleLbHealthCheck.bind(this),
                GetStatus: this.handleGetStatus.bind(this)
            });

            this.server.bindAsync(
                `0.0.0.0:${this.sharedPort}`,
                grpc.ServerCredentials.createInsecure(),
                (err, port) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    this.currentPort = port;
                    console.log(`[LoadBalancer-${this.mode}] 🎯 CAPTURED shared port ${port}`);
                    resolve();
                }
            );
        });
    }

    async checkOtherLoadBalancer() {
        if (!this.backupPort) {
            this.otherLbHealthy = false;
            return;
        }

        if (!this.otherLbClient) {
            const packageDefinition = protoLoader.loadSync(
                path.join(__dirname, 'load-balancer.proto'),
                {
                    keepCase: true,
                    longs: String,
                    enums: String,
                    defaults: true,
                    oneofs: true
                }
            );
            const lbProto = grpc.loadPackageDefinition(packageDefinition).loadbalancer;

            // Connect to other LB's backup port
            const otherBackupPort = this.mode === 'primary' ? this.backupPort + 1 : this.backupPort - 1;
            this.otherLbClient = new lbProto.LoadBalancerService(
                `localhost:${otherBackupPort}`,
                grpc.credentials.createInsecure()
            );
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.otherLbHealthy = false;
                reject(new Error('Timeout'));
            }, 1500);

            this.otherLbClient.HealthCheck({}, (err, response) => {
                clearTimeout(timeout);
                if (err) {
                    this.otherLbHealthy = false;
                    reject(err);
                } else {
                    this.otherLbHealthy = true;
                    resolve(response);
                }
            });
        });
    }

    async getOtherLbStatus() {
        return new Promise((resolve, reject) => {
            this.otherLbClient.GetStatus({}, (err, response) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(response);
                }
            });
        });
    }

    async isOtherLbActive() {
        try {
            const status = await this.getOtherLbStatus();
            return status.isActive;
        } catch {
            return false;
        }
    }

        becomeActive() {
        if (!this.isActive) {
            this.isActive = true;
            console.log(`[LoadBalancer-${this.mode}] 🟢 ACTIVE on port ${this.currentPort} - Handling requests`);
        }
    }

    async becomeInactive() {
        if (this.isActive) {
            this.isActive = false;
            console.log(`[LoadBalancer-${this.mode}] 🔴 GOING INACTIVE - Releasing port ${this.currentPort}`);
            
            if (this.server) {
                await new Promise((resolve) => {
                    this.server.tryShutdown(() => {
                        this.server = null;
                        this.currentPort = null;
                        resolve();
                    });
                });
            }
        }
    }

    // Request handlers (same as before, but with port info in logs)
    async handleGet(call, callback) {
        if (!this.isActive) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'Load balancer is not active'
            });
        }

        const { key } = call.request;
        const node = this.getNextHealthyNode();

        if (!node) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'No healthy nodes available'
            });
        }

        try {
            const client = this.getNodeClient(node);
            client.Get({ key }, (err, response) => {
                if (err) {
                    console.error(`[LoadBalancer-${this.mode}:${this.currentPort}] GET error from ${node.id}:`, err.message);
                    node.healthy = false;
                    callback(err);
                } else {
                    console.log(`[LoadBalancer-${this.mode}:${this.currentPort}] GET ${key} -> ${node.id}`);
                    callback(null, response);
                }
            });
        } catch (error) {
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal error'
            });
        }
    }

    async handlePut(call, callback) {
        if (!this.isActive) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'Load balancer is not active'
            });
        }

        const { key, value } = call.request;
        const node = this.getNextHealthyNode();

        if (!node) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'No healthy nodes available'
            });
        }

        try {
            const client = this.getNodeClient(node);
            client.Put({ key, value }, (err, response) => {
                if (err) {
                    console.error(`[LoadBalancer-${this.mode}:${this.currentPort}] PUT error from ${node.id}:`, err.message);
                    node.healthy = false;
                    callback(err);
                } else {
                    console.log(`[LoadBalancer-${this.mode}:${this.currentPort}] PUT ${key}=${value} -> ${node.id}`);
                    callback(null, response);
                }
            });
        } catch (error) {
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal error'
            });
        }
    }

    async handleDelete(call, callback) {
        if (!this.isActive) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'Load balancer is not active'
            });
        }

        const { key } = call.request;
        const node = this.getNextHealthyNode();

        if (!node) {
            return callback({
                code: grpc.status.UNAVAILABLE,
                message: 'No healthy nodes available'
            });
        }

        try {
            const client = this.getNodeClient(node);
            client.Delete({ key }, (err, response) => {
                if (err) {
                    console.error(`[LoadBalancer-${this.mode}:${this.currentPort}] DELETE error from ${node.id}:`, err.message);
                    node.healthy = false;
                    callback(err);
                } else {
                    console.log(`[LoadBalancer-${this.mode}:${this.currentPort}] DELETE ${key} -> ${node.id}`);
                    callback(null, response);
                }
            });
        } catch (error) {
            callback({
                code: grpc.status.INTERNAL,
                message: 'Internal error'
            });
        }
    }

    handleLbHealthCheck(call, callback) {
        this.lastHeartbeat = Date.now();
        callback(null, {
            healthy: true,
            timestamp: this.lastHeartbeat
        });
    }

    handleGetStatus(call, callback) {
        callback(null, {
            isActive: this.isActive,
            mode: this.mode,
            port: this.currentPort || this.backupPort,
            healthyNodes: this.nodes.filter(n => n.healthy).length,
            totalNodes: this.nodes.length,
            otherLbHealthy: this.otherLbHealthy
        });
    }

    // ... (keep all other methods the same: getNextHealthyNode, getNodeClient, startHealthChecks, etc.)
    getNextHealthyNode() {
        const healthyNodes = this.nodes.filter(node => node.healthy);
        if (healthyNodes.length === 0) {
            return null;
        }
        this.currentNodeIndex = (this.currentNodeIndex + 1) % healthyNodes.length;
        return healthyNodes[this.currentNodeIndex];
    }

    getNodeClient(node) {
        const nodeKey = `${node.host}:${node.port}`;
        if (!this.clients.has(nodeKey)) {
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
            const client = new kvProto.KeyValueService(
                nodeKey,
                grpc.credentials.createInsecure()
            );
            this.clients.set(nodeKey, client);
        }
        return this.clients.get(nodeKey);
    }

    startHealthChecks() {
        setInterval(() => {
            this.checkNodeHealth();
        }, this.healthCheckInterval);
        this.checkNodeHealth();
    }

    async checkNodeHealth() {
        const promises = this.nodes.map(async (node) => {
            try {
                const client = this.getNodeClient(node);

                return new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        node.healthy = false;
                        node.lastCheck = Date.now();
                        resolve();
                    }, 3000);

                    client.HealthCheck({}, (err, response) => {
                        clearTimeout(timeout);
                        if (err) {
                            node.healthy = false;
                        } else {
                            const wasUnhealthy = !node.healthy;
                            node.healthy = true;
                            if (wasUnhealthy && this.isActive) {
                                console.log(`[LoadBalancer-${this.mode}:${this.currentPort}] Node ${node.id} back online`);
                            }
                        }
                        node.lastCheck = Date.now();
                        resolve();
                    });
                });
            } catch (error) {
                node.healthy = false;
                node.lastCheck = Date.now();
            }
        });

        await Promise.allSettled(promises);

        const healthyCount = this.nodes.filter(n => n.healthy).length;
        if (healthyCount === 0 && this.isActive) {
            console.warn(`[LoadBalancer-${this.mode}:${this.currentPort}] ⚠️  WARNING: No healthy nodes available!`);
        }
    }

    async stop() {
        if (this.server) {
            await new Promise((resolve) => {
                this.server.tryShutdown(() => {
                    console.log(`[LoadBalancer-${this.mode}] Main server stopped`);
                    resolve();
                });
            });
        }

        if (this.coordinationServer) {
            await new Promise((resolve) => {
                this.coordinationServer.tryShutdown(() => {
                    console.log(`[LoadBalancer-${this.mode}] Coordination server stopped`);
                    resolve();
                });
            });
        }
    }
}

// CLI usage
if (require.main === module) {
    const sharedPort = process.argv[2] || 60051;
    const mode = process.argv[3] || 'primary';
    const backupPort = process.argv[4] || (mode === 'primary' ? 60061 : 60062);

    const loadBalancer = new LoadBalancer(
        parseInt(sharedPort),
        mode,
        parseInt(backupPort)
    );
    loadBalancer.start().catch(console.error);

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nShutting down load balancer...');
        await loadBalancer.stop();
        process.exit(0);
    });
}

module.exports = LoadBalancer;