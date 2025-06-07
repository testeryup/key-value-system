const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const readline = require('readline');

class KVClient {
    constructor() {
        this.client = null;
        this.setupClient();
    }

    setupClient() {
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
        this.client = new lbProto.LoadBalancerService(
            'localhost:60051',
            grpc.credentials.createInsecure()
        );
    }

    async get(key) {
        return new Promise((resolve, reject) => {
            this.client.Get({ key }, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    }

    async put(key, value) {
        return new Promise((resolve, reject) => {
            this.client.Put({ key, value }, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    }

    async delete(key) {
        return new Promise((resolve, reject) => {
            this.client.Delete({ key }, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    }

    async status() {
        return new Promise((resolve, reject) => {
            this.client.GetStatus({}, (err, response) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    }

    startCLI() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        console.log('🔑 KV Store Client');
        console.log('Commands: get <key> | put <key> <value> | delete <key> | status | exit\n');

        const prompt = () => {
            rl.question('kv> ', async (input) => {
                const parts = input.trim().split(' ');
                const command = parts[0];

                try {
                    switch (command) {
                        case 'get':
                            if (parts.length < 2) {
                                console.log('Usage: get <key>');
                            } else {
                                const result = await this.get(parts[1]);
                                console.log(result.found ? `"${result.value}"` : 'NOT_FOUND');
                            }
                            break;

                        case 'put':
                            if (parts.length < 3) {
                                console.log('Usage: put <key> <value>');
                            } else {
                                const key = parts[1];
                                const value = parts.slice(2).join(' ');
                                const result = await this.put(key, value);
                                console.log(result.success ? 'OK' : 'FAILED');
                            }
                            break;

                        case 'delete':
                        case 'del':
                            if (parts.length < 2) {
                                console.log('Usage: delete <key>');
                            } else {
                                const result = await this.delete(parts[1]);
                                console.log(result.success ? 'OK' : 'FAILED');
                            }
                            break;

                        case 'status':
                            const status = await this.status();
                            console.log(`Active: ${status.isActive}, Mode: ${status.mode}, Healthy: ${status.healthyNodes}/${status.totalNodes}`);
                            break;

                        case 'exit':
                        case 'quit':
                            console.log('Bye!');
                            rl.close();
                            return;

                        case '':
                            break;

                        default:
                            console.log('Unknown command. Available: get, put, delete, status, exit');
                    }
                } catch (error) {
                    console.log(`Error: ${error.message}`);
                }

                prompt();
            });
        };

        prompt();
    }
}

// CLI Mode
if (require.main === module) {
    const command = process.argv[2];
    const client = new KVClient();

    if (command) {
        // Single command mode
        const key = process.argv[3];
        const value = process.argv[4];

        (async () => {
            try {
                switch (command) {
                    case 'get':
                        const result = await client.get(key);
                        console.log(result.found ? result.value : 'NOT_FOUND');
                        break;
                    case 'put':
                        await client.put(key, value);
                        console.log('OK');
                        break;
                    case 'delete':
                        await client.delete(key);
                        console.log('OK');
                        break;
                    case 'status':
                        const status = await client.status();
                        console.log(`Active: ${status.isActive}, Mode: ${status.mode}, Healthy: ${status.healthyNodes}/${status.totalNodes}`);
                        break;
                    default:
                        console.log('Usage: node client.js [get|put|delete|status] [key] [value]');
                }
            } catch (error) {
                console.log(`Error: ${error.message}`);
            }
        })();
    } else {
        // Interactive mode
        client.startCLI();
    }
}

module.exports = KVClient;