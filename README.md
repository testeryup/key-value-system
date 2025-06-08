# Hệ Thống Key-Value Phân Tán

Một hệ thống key-value store phân tán được xây dựng bằng Node.js và gRPC, hỗ trợ load balancing, replication và failover tự động.

## 📋 Mục Lục

- [Tổng Quan](#tổng-quan)
- [Kiến Trúc Hệ Thống](#kiến-trúc-hệ-thống)
- [Cài Đặt](#cài-đặt)
- [Khởi Chạy Hệ Thống](#khởi-chạy-hệ-thống)
- [Sử Dụng Client](#sử-dụng-client)
- [API Reference](#api-reference)
- [Cấu Trúc Dữ Liệu](#cấu-trúc-dữ-liệu)
- [Tính Năng Đồng Bộ](#tính-năng-đồng-bộ)
- [Kiểm Thử](#kiểm-thử)
- [Troubleshooting](#troubleshooting)

## 🎯 Tổng Quan

Hệ thống này bao gồm:
- **3 KV Nodes**: Lưu trữ dữ liệu với replication tự động (ports 50051, 50052, 50053)
- **2 Load Balancers**: Primary/Secondary với failover tự động (shared port 60051)
- **1 Client**: Giao diện CLI đơn giản

### Đặc Điểm Chính
- ✅ **Replication**: Dữ liệu tự động đồng bộ giữa 3 nodes
- ✅ **Load Balancing**: Round-robin distribution  
- ✅ **High Availability**: Primary/Secondary LB với shared port competition
- ✅ **Persistence**: Lưu vào JSON files với timestamp
- ✅ **Health Monitoring**: Tự động phát hiện node failure
- ✅ **Node Recovery**: Tự động sync khi node restart
- ✅ **Conflict Resolution**: Timestamp-based conflict resolution

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│   Client    │───▶│  Load Balancer   │───▶│   KV Node   │
│   :60051    │    │ Shared Port:60051│    │   kv1:50051 │
└─────────────┘    │Primary:60061     │    │   kv2:50052 │
                   │Secondary:60062   │    │   kv3:50053 │
                   └──────────────────┘    └─────────────┘
                            │                     │
                            ▼                     ▼
                   ┌──────────────────┐    ┌─────────────┐
                   │ Health Checking  │    │ Replication │
                   │ & Failover       │    │ & Sync      │
                   └──────────────────┘    └─────────────┘
```

## 📦 Cài Đặt

### Yêu Cầu Hệ Thống
- Node.js >= 14.0.0
- npm >= 6.0.0

### Cài đặt dependencies
```bash
npm install
```

### Cấu trúc thư mục hiện tại
```
key-value-system/
├── single-node.js          # KV Node với sync capability
├── load-balancer.js        # Load Balancer (Primary/Secondary)
├── client.js               # CLI Client
├── single-node.proto       # gRPC cho KV nodes (có RequestSync)
├── load-balancer.proto     # gRPC cho Load Balancer
├── package.json            # Dependencies & scripts
├── kv1-db.json            # Database node 1 (có lastSyncTime)
├── kv2-db.json            # Database node 2 (có lastSyncTime)
├── kv3-db.json            # Database node 3 (có lastSyncTime)
└── README.md
```

## 🚀 Khởi Chạy Hệ Thống

### Mở 5 terminals và chạy:

**Terminal 1-3: KV Nodes**
```bash
npm run start:kv1    # Port 50051
npm run start:kv2    # Port 50052
npm run start:kv3    # Port 50053
```

**Terminal 4-5: Load Balancers**
```bash
npm run start:lb-primary      # Shared port 60051, coord 60061
npm run start:lb-secondary    # Shared port 60051, coord 60062
```

### Kiểm tra hệ thống khởi động thành công:
```
[kv1] KV Node started on port 50051
[kv1] 🔄 Starting initial sync...
[kv1] 🚀 Node ready to serve requests
[LoadBalancer-primary] 🎯 CAPTURED shared port 60051
[LoadBalancer-primary] 🟢 ACTIVE on port 60051
```

## 💻 Sử Dụng Client

### Chế Độ Interactive
```bash
node client.js
```

CLI Interface:
```
🔑 KV Store Client
Commands: get <key> | put <key> <value> | delete <key> | status | exit

kv> put user:1 "Nguyễn Văn A"
OK

kv> get user:1
"Nguyễn Văn A"

kv> delete user:1
OK

kv> status
Active: true, Mode: primary, Healthy: 3/3

kv> exit
Bye!
```

### Chế Độ Single Command
```bash
node client.js put mykey "myvalue"    # Output: OK
node client.js get mykey              # Output: myvalue
node client.js delete mykey           # Output: OK
node client.js status                 # Output: Active: true, Mode: primary, Healthy: 3/3
```

## 📚 API Reference

### Client Commands
| Command | Description | Example |
|---------|-------------|---------|
| `get <key>` | Lấy giá trị | `get user:123` |
| `put <key> <value>` | Lưu dữ liệu | `put user:123 "John"` |
| `delete <key>` | Xóa key | `delete user:123` |
| `status` | Trạng thái LB | `status` |
| `exit` | Thoát | `exit` |

### gRPC Services

**KV Node Service (single-node.proto)**
```protobuf
service KeyValueService {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
    rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
    rpc Replicate(ReplicateRequest) returns (ReplicateResponse);
    rpc RequestSync(SyncRequest) returns (SyncResponse);  // NEW: For recovery
}
```

**Load Balancer Service (load-balancer.proto)**
```protobuf
service LoadBalancerService {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
    rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
    rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
}
```

## 💾 Cấu Trúc Dữ Liệu

### Database Files Format (Updated)
```json
{
  "data": {
    "yolo": {
      "value": "321",
      "timestamp": 1749401499246
    },
    "chichi": {
      "value": "123", 
      "timestamp": 1749401506790
    }
  },
  "lastSyncTime": 1749401670094,
  "savedAt": 1749401670094
}
```

**Giải thích:**
- **data**: Object chứa tất cả key-value pairs
- **key**: Tên key (vd: "yolo")
- **value**: Giá trị được lưu (vd: "321")
- **timestamp**: Unix timestamp khi tạo/update
- **lastSyncTime**: Timestamp của lần sync cuối cùng
- **savedAt**: Timestamp khi file được save

### Replication Flow
1. Client gửi PUT/DELETE tới Load Balancer
2. Load Balancer forward tới 1 KV node
3. KV node xử lý và gọi `replicateToOthers()`
4. Replicate tới 2 nodes còn lại qua gRPC `Replicate`
5. Update lastSyncTime và save to disk
6. Tất cả nodes có dữ liệu giống nhau

## 🔄 Tính Năng Đồng Bộ

### Initial Sync khi Node Restart
Khi một node khởi động lại, nó sẽ:

1. **Load dữ liệu local** và `lastSyncTime`
2. **Request sync** từ các nodes khác
3. **Merge dữ liệu** với conflict resolution
4. **Update lastSyncTime** và save
5. **Ready to serve** requests

```bash
# Log example khi node restart
[kv2] 🔄 Starting initial sync...
[kv2] Attempting sync from kv1...
[kv2] ✅ Successfully synced from kv1
[kv2] Received 5 items
[kv2] 📥 Added new key: newkey
[kv2] 🔄 Updated key: existingkey (remote newer)
[kv2] 💾 Sync completed and saved to disk
[kv2] 🚀 Node ready to serve requests
```

### Conflict Resolution
- **Newer timestamp wins**: Dữ liệu có timestamp mới hơn được chọn
- **Local wins on tie**: Nếu timestamp bằng nhau, giữ dữ liệu local
- **Add missing keys**: Thêm keys mà local không có

### Protection During Sync
- **Reject requests** khi node đang sync: `isInitializing = true`
- **Return proper gRPC error**: `UNAVAILABLE` status
- **Load balancer adapts**: Tự động route tới nodes khác

## 🧪 Kiểm Thử

### Test Replication
```bash
# Terminal client
node client.js
kv> put test_key "test_value"

# Kiểm tra 3 files có data giống nhau
type kv1-db.json  # Windows
type kv2-db.json  # Windows  
type kv3-db.json  # Windows

# Hoặc Linux/Mac
cat kv1-db.json
cat kv2-db.json
cat kv3-db.json
```

### Test Node Recovery & Sync
```bash
# 1. Start tất cả nodes
npm run start:kv1
npm run start:kv2
npm run start:kv3
npm run start:lb-primary

# 2. Add data
node client.js put key1 "value1"
node client.js put key2 "value2"

# 3. Stop một node
# Ctrl+C tại terminal kv2

# 4. Add thêm data khi kv2 down
node client.js put key3 "value3"
node client.js delete key1

# 5. Restart kv2 - sẽ thấy sync process
npm run start:kv2

# 6. Kiểm tra kv2 đã có đầy đủ data
node client.js get key3  # Should return "value3"
node client.js get key1  # Should return NOT_FOUND
```

### Test Load Balancer Failover
```bash
# 1. Chạy cả 2 LBs
npm run start:lb-primary      # Terminal 4
npm run start:lb-secondary    # Terminal 5

# 2. Kill primary (Ctrl+C terminal 4)
# 3. Secondary sẽ capture port 60051
# 4. Client vẫn hoạt động bình thường

# 5. Restart primary - sẽ reclaim port
npm run start:lb-primary
```

### Test Node Failure với Load Balancer
```bash
# 1. Kill kv2 (Ctrl+C)
# 2. Load balancer tự động loại kv2 khỏi rotation
# 3. Requests chỉ tới kv1 và kv3
# 4. Restart kv2 - tự động sync và được thêm lại
npm run start:kv2
```

### Test Conflict Resolution
```bash
# 1. Stop kv2 và kv3
# 2. Add data vào kv1: put test "from_kv1"
# 3. Stop kv1, start kv2
# 4. Add data vào kv2: put test "from_kv2" 
# 5. Start kv1 - sẽ thấy conflict resolution
# 6. Newer timestamp wins
```

## 🔧 Configuration

### Ports
| Component | Port | Configurable |
|-----------|------|--------------|
| kv1 | 50051 | ✅ |
| kv2 | 50052 | ✅ |
| kv3 | 50053 | ✅ |
| LB Shared | 60051 | ✅ |
| LB Primary Coord | 60061 | ✅ |
| LB Secondary Coord | 60062 | ✅ |

### Package.json Scripts
```json
{
  "start:kv1": "node single-node.js 50051 kv1",
  "start:kv2": "node single-node.js 50052 kv2", 
  "start:kv3": "node single-node.js 50053 kv3",
  "start:lb-primary": "node load-balancer.js 60051 primary 60061",
  "start:lb-secondary": "node load-balancer.js 60051 secondary 60062"
}
```

### Sync Configuration (trong single-node.js)
```javascript
// Sync configuration
this.syncRetryAttempts = 3;
this.syncRetryDelay = 2000; // 2 seconds
this.healthCheckInterval = 5000; // 5 seconds
this.leaderElectionInterval = 2000; // 2 seconds
```

## 🐛 Troubleshooting

### Lỗi "EADDRINUSE"
```bash
# Kiểm tra port đang được sử dụng
netstat -ano | findstr :50051    # Windows
lsof -i :50051                   # Linux/Mac

# Kill process
taskkill /PID <PID> /F          # Windows
kill -9 <PID>                   # Linux/Mac
```

### Lỗi "No healthy nodes available"
```bash
# Kiểm tra nodes đang chạy
tasklist | findstr node         # Windows
ps aux | grep single-node      # Linux/Mac

# Restart thiếu nodes
npm run start:kv1
npm run start:kv2
npm run start:kv3
```

### Lỗi "Node is initializing"
```bash
# Node đang sync, chờ một chút
# Hoặc check logs để thấy sync progress
# Nếu bị stuck, restart node:
# Ctrl+C và npm run start:kvX
```

### Lỗi Client không connect được
```bash
# Test port 60051
telnet localhost 60051

# Restart load balancers
npm run start:lb-primary
npm run start:lb-secondary
```

### Health Check với gRPC

**Tạo file `health-check.js`:**
```javascript
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load proto
const kvProto = grpc.loadPackageDefinition(
    protoLoader.loadSync('./single-node.proto')
).keyvalue;

const lbProto = grpc.loadPackageDefinition(
    protoLoader.loadSync('./load-balancer.proto')
).loadbalancer;

// Check KV nodes
[50051, 50052, 50053].forEach(port => {
    const client = new kvProto.KeyValueService(
        `localhost:${port}`, 
        grpc.credentials.createInsecure()
    );
    
    client.HealthCheck({}, (err, response) => {
        if (err) {
            console.log(`KV${port}: FAIL - ${err.message}`);
        } else {
            console.log(`KV${port}: OK (initializing: ${response.isInitializing})`);
        }
    });
});

// Check Load Balancer
const lbClient = new lbProto.LoadBalancerService(
    'localhost:60051',
    grpc.credentials.createInsecure()
);

lbClient.HealthCheck({}, (err, response) => {
    console.log(`LoadBalancer: ${err ? 'FAIL' : 'OK'}`);
});
```

```bash
node health-check.js
```

### Debug Sync Issues
```bash
# Check database files lastSyncTime
type kv1-db.json | find "lastSyncTime"   # Windows
grep "lastSyncTime" kv1-db.json          # Linux/Mac

# Compare timestamps between nodes
# Newer timestamp = more recent data
```

### Data Consistency Check
```bash
# Quick script để check data consistency
echo "Checking data consistency..."
echo "KV1 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv1-db.json')).data))"
echo "KV2 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv2-db.json')).data))"  
echo "KV3 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv3-db.json')).data))"
```

---

**🎉 Hệ thống Key-Value Store với đầy đủ tính năng đồng bộ và recovery!**

### 🚀 Quick Start
```bash
# Terminal 1-3: Start nodes
npm run start:kv1 & npm run start:kv2 & npm run start:kv3

# Terminal 4-5: Start load balancers  
npm run start:lb-primary & npm run start:lb-secondary

# Terminal 6: Use client
node client.js
```